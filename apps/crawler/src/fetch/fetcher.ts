import type { GateClient } from './gate-client'
import { checkRobots, type RobotsCache } from './robots'

export const DEFAULT_TIMEOUT_MS = 30_000
export const DEFAULT_MAX_BODY_BYTES = 5 * 1024 * 1024
export const MAX_REDIRECTS = 3
const BACKOFF_BASE_SEC = 30
const BACKOFF_CAP_SEC = 60 * 60
const RETRY_AFTER_CAP_SEC = 24 * 60 * 60

export interface FetchDeps {
  fetch: typeof fetch
  gate: GateClient
  robotsCache: RobotsCache
  sleep: (ms: number) => Promise<void>
  now: () => number
  userAgent: string
  timeoutMs?: number
  maxBodyBytes?: number
}

export interface FetchRequest {
  url: string
  etag?: string | null
  lastModified?: string | null
  // 0 始まりの試行回数。5xx のバックオフ計算に使う（呼び出し側が再投入のたびに増やす）
  attempt?: number
}

export type FetchResult =
  | { kind: 'not_modified' }
  | {
      kind: 'ok'
      body: string
      httpStatus: number
      bytes: number
      etag: string | null
      lastModified: string | null
    }
  // disallowed = robots.txt が禁止。robots_unavailable = robots.txt が取れず安全側で止めた（今回だけ。次回再試行）
  | { kind: 'blocked'; reason: 'robots'; detail: 'disallowed' | 'robots_unavailable' }
  | { kind: 'retry'; afterSec: number; reason: 'rate_limited' | 'server_error' }
  | { kind: 'error'; httpStatus?: number; error: string }

export function backoffSec(attempt: number): number {
  return Math.min(BACKOFF_CAP_SEC, BACKOFF_BASE_SEC * 2 ** Math.max(0, attempt))
}

// Retry-After は秒数か HTTP 日付。解釈できなければ null。
export function parseRetryAfter(value: string | null, nowMs: number): number | null {
  if (value === null) return null
  const trimmed = value.trim()
  if (/^\d+$/.test(trimmed)) return Math.min(RETRY_AFTER_CAP_SEC, Number(trimmed))
  const at = Date.parse(trimmed)
  if (Number.isNaN(at)) return null
  return Math.min(RETRY_AFTER_CAP_SEC, Math.max(0, Math.ceil((at - nowMs) / 1000)))
}

function parseHttpUrl(raw: string): URL | null {
  try {
    const url = new URL(raw)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null
  } catch {
    return null
  }
}

async function readCapped(res: Response, maxBytes: number): Promise<Uint8Array | null> {
  const declared = Number(res.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel()
    return null
  }
  if (!res.body) return new Uint8Array(0)
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

export async function conditionalFetch(deps: FetchDeps, request: FetchRequest): Promise<FetchResult> {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxBytes = deps.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES
  const attempt = request.attempt ?? 0

  const throttle = async (url: URL, crawlDelaySec: number | null): Promise<void> => {
    const { waitMs } = await deps.gate.reserve(url.host, crawlDelaySec)
    if (waitMs > 0) await deps.sleep(waitMs)
  }

  let current = parseHttpUrl(request.url)
  if (!current) return { kind: 'error', error: `unsupported or invalid URL: ${request.url}` }

  // 転送先ごとに robots.txt を確認し直すため、リダイレクトは自分で追う
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const decision = await checkRobots(
      {
        fetch: deps.fetch,
        robotsCache: deps.robotsCache,
        userAgent: deps.userAgent,
        timeoutMs,
        throttle: (u) => throttle(u, null)
      },
      current
    )
    if (!decision.allowed) return { kind: 'blocked', reason: 'robots', detail: decision.reason }

    await throttle(current, decision.crawlDelaySec)

    const headers: Record<string, string> = { 'User-Agent': deps.userAgent }
    if (request.etag) headers['If-None-Match'] = request.etag
    if (request.lastModified) headers['If-Modified-Since'] = request.lastModified

    let res: Response
    try {
      res = await deps.fetch(current.href, {
        headers,
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs)
      })
    } catch (e) {
      return { kind: 'error', error: e instanceof Error ? e.message : String(e) }
    }

    if (res.status === 304) {
      await res.body?.cancel()
      return { kind: 'not_modified' }
    }

    if (res.status >= 300 && res.status < 400) {
      await res.body?.cancel()
      const location = res.headers.get('location')
      if (!location) return { kind: 'error', httpStatus: res.status, error: 'redirect without Location' }
      const next = parseHttpUrl(new URL(location, current).href)
      if (!next) return { kind: 'error', httpStatus: res.status, error: `redirect to unsupported URL: ${location}` }
      current = next
      continue
    }

    if (res.status === 429 || res.status >= 500) {
      await res.body?.cancel()
      const retryAfter = parseRetryAfter(res.headers.get('retry-after'), deps.now())
      return {
        kind: 'retry',
        afterSec: retryAfter ?? backoffSec(attempt),
        reason: res.status === 429 ? 'rate_limited' : 'server_error'
      }
    }

    if (res.status >= 400) {
      await res.body?.cancel()
      return { kind: 'error', httpStatus: res.status, error: `HTTP ${res.status}` }
    }

    try {
      const bytes = await readCapped(res, maxBytes)
      if (bytes === null) {
        return { kind: 'error', httpStatus: res.status, error: `body exceeds ${maxBytes} bytes` }
      }
      return {
        kind: 'ok',
        body: new TextDecoder().decode(bytes),
        httpStatus: res.status,
        bytes: bytes.byteLength,
        etag: res.headers.get('etag'),
        lastModified: res.headers.get('last-modified')
      }
    } catch (e) {
      return { kind: 'error', httpStatus: res.status, error: e instanceof Error ? e.message : String(e) }
    }
  }
  return { kind: 'error', error: `too many redirects (> ${MAX_REDIRECTS})` }
}
