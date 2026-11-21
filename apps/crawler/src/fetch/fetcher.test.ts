// ローカルのモック HTTP サーバーのためだけに Node の型を使う（本番コードは使わない）
/// <reference types="node" />
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildUserAgent } from './config'
import { backoffSec, conditionalFetch, parseRetryAfter, type FetchDeps } from './fetcher'
import { inMemoryGate } from './gate-client'
import { InMemoryRobotsCache } from './robots'

type Handler = (req: IncomingMessage, res: ServerResponse) => void

interface Mock {
  server: Server
  base: string
  hits: string[]
  userAgents: string[]
}

async function startMock(handler: Handler): Promise<Mock> {
  const hits: string[] = []
  const userAgents: string[] = []
  const server = createServer((req, res) => {
    hits.push(req.url ?? '')
    userAgents.push(String(req.headers['user-agent']))
    handler(req, res)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return { server, base: `http://127.0.0.1:${port}`, hits, userAgents }
}

const ROBOTS = 'User-agent: *\nDisallow: /private\n'

function standard(extra: Handler): Handler {
  return (req, res) => {
    if (req.url === '/robots.txt') {
      res.writeHead(200, { 'Content-Type': 'text/plain' }).end(ROBOTS)
      return
    }
    extra(req, res)
  }
}

describe('conditionalFetch (local mock server)', () => {
  const mocks: Mock[] = []
  let nowMs: number
  let sleeps: number[]
  let deps: FetchDeps

  const start = async (h: Handler): Promise<Mock> => {
    const m = await startMock(h)
    mocks.push(m)
    return m
  }

  beforeEach(() => {
    nowMs = Date.parse('2026-11-21T00:00:00Z')
    sleeps = []
    deps = {
      fetch,
      gate: inMemoryGate(() => nowMs),
      robotsCache: new InMemoryRobotsCache(() => nowMs),
      sleep: async (ms) => {
        sleeps.push(ms)
        nowMs += ms
      },
      now: () => nowMs,
      userAgent: buildUserAgent('https://crawler.test/about')
    }
  })

  afterEach(async () => {
    await Promise.all(mocks.splice(0).map((m) => new Promise((r) => m.server.close(r))))
  })

  // Contract: a path disallowed by robots.txt is never requested.
  it('does not fetch a robots-disallowed path', async () => {
    const m = await start(standard((_req, res) => res.writeHead(200).end('secret')))
    const result = await conditionalFetch(deps, { url: `${m.base}/private/page` })
    expect(result).toEqual({ kind: 'blocked', reason: 'robots', detail: 'disallowed' })
    expect(m.hits).toEqual(['/robots.txt'])
  })

  // Contract: 200 returns body, size and validators; the request carries our UA.
  it('returns the body with validators and sends the UA', async () => {
    const m = await start(
      standard((_req, res) => res.writeHead(200, { ETag: '"v1"', 'Last-Modified': 'Sat, 21 Nov 2026 00:00:00 GMT' }).end('hello'))
    )
    const result = await conditionalFetch(deps, { url: `${m.base}/schedule` })
    expect(result).toEqual({
      kind: 'ok',
      body: 'hello',
      httpStatus: 200,
      bytes: 5,
      etag: '"v1"',
      lastModified: 'Sat, 21 Nov 2026 00:00:00 GMT'
    })
    expect(m.userAgents.every((ua) => ua === 'live-info-mcp-crawler/0.1 (+https://crawler.test/about)')).toBe(true)
  })

  // Contract: validators are sent as If-None-Match / If-Modified-Since and a 304 maps to not_modified.
  it('maps 304 to not_modified and sends conditional headers', async () => {
    const seen: Record<string, string | string[] | undefined>[] = []
    const m = await start(
      standard((req, res) => {
        seen.push({ inm: req.headers['if-none-match'], ims: req.headers['if-modified-since'] })
        res.writeHead(304).end()
      })
    )
    const result = await conditionalFetch(deps, {
      url: `${m.base}/schedule`,
      etag: '"v1"',
      lastModified: 'Sat, 21 Nov 2026 00:00:00 GMT'
    })
    expect(result).toEqual({ kind: 'not_modified' })
    expect(seen).toEqual([{ inm: '"v1"', ims: 'Sat, 21 Nov 2026 00:00:00 GMT' }])
  })

  // Contract: 429 yields a retry with Retry-After seconds; the fetcher does not loop on its own.
  it('maps 429 with Retry-After seconds to retry without looping', async () => {
    const m = await start(standard((_req, res) => res.writeHead(429, { 'Retry-After': '7' }).end()))
    const result = await conditionalFetch(deps, { url: `${m.base}/schedule` })
    expect(result).toEqual({ kind: 'retry', afterSec: 7, reason: 'rate_limited' })
    expect(m.hits.filter((h) => h === '/schedule')).toHaveLength(1)
  })

  it('parses a Retry-After HTTP date relative to the injected clock', async () => {
    const date = new Date(nowMs + 90_000).toUTCString()
    const m = await start(standard((_req, res) => res.writeHead(429, { 'Retry-After': date }).end()))
    const result = await conditionalFetch(deps, { url: `${m.base}/schedule` })
    // 90s から、robots.txt と本体の間でゲートが待たせた 5s を引いた値
    expect(result).toEqual({ kind: 'retry', afterSec: 85, reason: 'rate_limited' })
  })

  // Contract: 5xx backs off exponentially from the caller's attempt counter, capped.
  it('maps 5xx to retry with exponential backoff from the attempt counter', async () => {
    const m = await start(standard((_req, res) => res.writeHead(503).end()))
    const first = await conditionalFetch(deps, { url: `${m.base}/schedule`, attempt: 0 })
    const third = await conditionalFetch(deps, { url: `${m.base}/schedule`, attempt: 2 })
    const huge = await conditionalFetch(deps, { url: `${m.base}/schedule`, attempt: 30 })
    expect(first).toEqual({ kind: 'retry', afterSec: 30, reason: 'server_error' })
    expect(third).toEqual({ kind: 'retry', afterSec: 120, reason: 'server_error' })
    expect(huge).toEqual({ kind: 'retry', afterSec: 3600, reason: 'server_error' })
  })

  it('maps other 4xx to error', async () => {
    const m = await start(standard((_req, res) => res.writeHead(404).end()))
    expect(await conditionalFetch(deps, { url: `${m.base}/gone` })).toEqual({
      kind: 'error',
      httpStatus: 404,
      error: 'HTTP 404'
    })
  })

  // Contract: unreachable robots.txt fails closed for this run and is not cached.
  it('fails closed when robots.txt returns 5xx, and does not cache that', async () => {
    const m = await start((req, res) => res.writeHead(req.url === '/robots.txt' ? 500 : 200).end('x'))
    const result = await conditionalFetch(deps, { url: `${m.base}/schedule` })
    expect(result).toEqual({ kind: 'blocked', reason: 'robots', detail: 'robots_unavailable' })
    expect(m.hits).toEqual(['/robots.txt'])
    await conditionalFetch(deps, { url: `${m.base}/schedule` })
    expect(m.hits.filter((h) => h === '/robots.txt')).toHaveLength(2)
  })

  it('treats a 404 robots.txt as allow-all and caches robots.txt for 24h', async () => {
    const m = await start((req, res) => res.writeHead(req.url === '/robots.txt' ? 404 : 200).end('page'))
    expect((await conditionalFetch(deps, { url: `${m.base}/a` })).kind).toBe('ok')
    expect((await conditionalFetch(deps, { url: `${m.base}/b` })).kind).toBe('ok')
    expect(m.hits.filter((h) => h === '/robots.txt')).toHaveLength(1)
    nowMs += 25 * 3600 * 1000
    await conditionalFetch(deps, { url: `${m.base}/c` })
    expect(m.hits.filter((h) => h === '/robots.txt')).toHaveLength(2)
  })

  // Contract: >= 5s between requests to the same host (robots.txt counts too).
  it('waits at least 5s between requests to the same host', async () => {
    const m = await start(standard((_req, res) => res.writeHead(200).end('ok')))
    await conditionalFetch(deps, { url: `${m.base}/a` })
    // robots.txt (slot 0) -> /a (slot +5s)
    expect(sleeps).toEqual([5000])
  })

  it('rejects non-http(s) URLs', async () => {
    expect(await conditionalFetch(deps, { url: 'file:///etc/passwd' })).toMatchObject({ kind: 'error' })
    expect(await conditionalFetch(deps, { url: 'ftp://example.com/x' })).toMatchObject({ kind: 'error' })
    expect(await conditionalFetch(deps, { url: 'not a url' })).toMatchObject({ kind: 'error' })
  })

  it('errors when the body exceeds the size cap', async () => {
    const m = await start(standard((_req, res) => res.writeHead(200).end('x'.repeat(2000))))
    const result = await conditionalFetch({ ...deps, maxBodyBytes: 1000 }, { url: `${m.base}/big` })
    expect(result).toMatchObject({ kind: 'error', httpStatus: 200 })
  })

  it('errors on network failure', async () => {
    const m = await start(standard((_req, res) => res.writeHead(200).end('ok')))
    const url = `${m.base}/a`
    await new Promise((r) => m.server.close(r))
    expect((await conditionalFetch(deps, { url })).kind).toBe('blocked') // robots.txt unreachable -> fail closed
    const cachedDeps = { ...deps, robotsCache: new InMemoryRobotsCache(() => nowMs) }
    await cachedDeps.robotsCache.put(new URL(url).origin, { rules: [], crawlDelaySec: null }, 60)
    expect((await conditionalFetch(cachedDeps, { url })).kind).toBe('error')
  })

  // Contract: a redirect to another origin re-runs the robots check for that origin.
  it('re-checks robots on a cross-origin redirect', async () => {
    const target = await start((req, res) =>
      req.url === '/robots.txt'
        ? res.writeHead(200).end('User-agent: *\nDisallow: /\n')
        : res.writeHead(200).end('should not be fetched')
    )
    const origin = await start(standard((_req, res) => res.writeHead(302, { Location: `${target.base}/page` }).end()))
    const result = await conditionalFetch(deps, { url: `${origin.base}/start` })
    expect(result).toEqual({ kind: 'blocked', reason: 'robots', detail: 'disallowed' })
    expect(target.hits).toEqual(['/robots.txt'])
  })

  it('follows a same-origin redirect and stops after 3 hops', async () => {
    const m = await start(
      standard((req, res) => {
        if (req.url === '/final') return void res.writeHead(200).end('done')
        if (req.url === '/loop') return void res.writeHead(302, { Location: '/loop' }).end()
        res.writeHead(302, { Location: '/final' }).end()
      })
    )
    expect(await conditionalFetch(deps, { url: `${m.base}/start` })).toMatchObject({ kind: 'ok', body: 'done' })
    expect(await conditionalFetch(deps, { url: `${m.base}/loop` })).toMatchObject({ kind: 'error' })
  })
})

describe('retry helpers', () => {
  it('backoffSec doubles and caps', () => {
    expect([0, 1, 2, 3].map(backoffSec)).toEqual([30, 60, 120, 240])
    expect(backoffSec(50)).toBe(3600)
  })

  it('parseRetryAfter handles seconds, dates, garbage and past dates', () => {
    const now = Date.parse('2026-11-21T00:00:00Z')
    expect(parseRetryAfter('120', now)).toBe(120)
    expect(parseRetryAfter('Sat, 21 Nov 2026 00:01:00 GMT', now)).toBe(60)
    expect(parseRetryAfter('Fri, 20 Nov 2026 00:00:00 GMT', now)).toBe(0)
    expect(parseRetryAfter('soon', now)).toBeNull()
    expect(parseRetryAfter(null, now)).toBeNull()
  })
})
