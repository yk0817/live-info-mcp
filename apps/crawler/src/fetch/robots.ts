import { PRODUCT_TOKEN } from './config'

export interface RobotsRule {
  allow: boolean
  pattern: string
}

// 自分の UA に適用されるグループだけを残した、JSON にできる形。
export interface RobotsRules {
  rules: readonly RobotsRule[]
  crawlDelaySec: number | null
}

export const ALLOW_ALL: RobotsRules = { rules: [], crawlDelaySec: null }

export interface RobotsCache {
  get(origin: string): Promise<RobotsRules | undefined>
  put(origin: string, rules: RobotsRules, ttlSec: number): Promise<void>
}

export const ROBOTS_TTL_SEC = 24 * 60 * 60

interface Group {
  agents: string[]
  rules: RobotsRule[]
  crawlDelaySec: number | null
}

// RFC 9309 の要点だけ: グループ選択は「自分の製品名を含む UA」を優先し、無ければ `*`。
// 同じ UA の複数グループは結合する。
export function parseRobots(text: string, productToken: string = PRODUCT_TOKEN): RobotsRules {
  const groups: Group[] = []
  let current: Group | null = null
  let lastWasAgent = false
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim()
    const idx = line.indexOf(':')
    if (idx < 0) continue
    const field = line.slice(0, idx).trim().toLowerCase()
    const value = line.slice(idx + 1).trim()
    if (field === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [], crawlDelaySec: null }
        groups.push(current)
      }
      current.agents.push(value.toLowerCase())
      lastWasAgent = true
      continue
    }
    lastWasAgent = false
    if (!current) continue
    if (field === 'allow' || field === 'disallow') {
      // 空の Disallow は「全許可」で、ルールとしては意味を持たない
      if (value !== '') current.rules.push({ allow: field === 'allow', pattern: value })
    } else if (field === 'crawl-delay') {
      const n = Number(value)
      if (Number.isFinite(n) && n >= 0) current.crawlDelaySec = n
    }
  }
  const token = productToken.toLowerCase()
  const specific = groups.filter((g) => g.agents.some((a) => a !== '*' && token.includes(a)))
  const chosen = specific.length > 0 ? specific : groups.filter((g) => g.agents.includes('*'))
  const delays = chosen.map((g) => g.crawlDelaySec).filter((d): d is number => d !== null)
  return {
    rules: chosen.flatMap((g) => g.rules),
    crawlDelaySec: delays.length > 0 ? Math.max(...delays) : null
  }
}

function patternToRegExp(pattern: string): RegExp {
  const anchored = pattern.endsWith('$')
  const body = anchored ? pattern.slice(0, -1) : pattern
  const escaped = body.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
  return new RegExp(`^${escaped}${anchored ? '$' : ''}`)
}

// 最長一致が勝ち、同じ長さなら Allow が勝つ。
export function isAllowedByRules(rules: RobotsRules, pathAndQuery: string): boolean {
  let best: { len: number; allow: boolean } | null = null
  for (const rule of rules.rules) {
    if (!patternToRegExp(rule.pattern).test(pathAndQuery)) continue
    const len = rule.pattern.length
    if (best === null || len > best.len || (len === best.len && rule.allow)) {
      best = { len, allow: rule.allow }
    }
  }
  return best === null ? true : best.allow
}

export type RobotsDecision =
  | { allowed: true; crawlDelaySec: number | null }
  | { allowed: false; reason: 'disallowed' | 'robots_unavailable' }

export interface RobotsDeps {
  fetch: typeof fetch
  robotsCache: RobotsCache
  userAgent: string
  timeoutMs: number
  // robots.txt の取得も同じドメインの 5 秒間隔に数える
  throttle: (url: URL) => Promise<void>
}

export async function checkRobots(deps: RobotsDeps, url: URL): Promise<RobotsDecision> {
  const origin = url.origin
  let rules = await deps.robotsCache.get(origin)
  if (!rules) {
    const fetched = await fetchRobotsRules(deps, origin)
    // 取得できなかった（5xx・ネットワーク）ときは安全側で止め、キャッシュしない
    if (fetched === null) return { allowed: false, reason: 'robots_unavailable' }
    rules = fetched
    await deps.robotsCache.put(origin, rules, ROBOTS_TTL_SEC)
  }
  if (!isAllowedByRules(rules, url.pathname + url.search)) return { allowed: false, reason: 'disallowed' }
  return { allowed: true, crawlDelaySec: rules.crawlDelaySec }
}

async function fetchRobotsRules(deps: RobotsDeps, origin: string): Promise<RobotsRules | null> {
  const robotsUrl = new URL('/robots.txt', origin)
  try {
    await deps.throttle(robotsUrl)
    const res = await deps.fetch(robotsUrl.href, {
      headers: { 'User-Agent': deps.userAgent },
      redirect: 'follow',
      signal: AbortSignal.timeout(deps.timeoutMs)
    })
    if (res.status >= 500) {
      await res.body?.cancel()
      return null
    }
    // 4xx（404 含む）は robots.txt なし = 全許可（RFC 9309）
    if (res.status >= 400) {
      await res.body?.cancel()
      return ALLOW_ALL
    }
    return parseRobots((await res.text()).slice(0, 512 * 1024))
  } catch {
    return null
  }
}

// Workers の Cache API 実装。TTL は Cache-Control: max-age で効かせる。
export class WorkersRobotsCache implements RobotsCache {
  constructor(private readonly cache: Cache) {}

  private key(origin: string): Request {
    return new Request(`https://robots-cache.invalid/${encodeURIComponent(origin)}`)
  }

  async get(origin: string): Promise<RobotsRules | undefined> {
    const hit = await this.cache.match(this.key(origin))
    if (!hit) return undefined
    return (await hit.json()) as RobotsRules
  }

  async put(origin: string, rules: RobotsRules, ttlSec: number): Promise<void> {
    await this.cache.put(
      this.key(origin),
      new Response(JSON.stringify(rules), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${ttlSec}` }
      })
    )
  }
}

export class InMemoryRobotsCache implements RobotsCache {
  private readonly store = new Map<string, { rules: RobotsRules; expiresAt: number }>()

  constructor(private readonly now: () => number) {}

  async get(origin: string): Promise<RobotsRules | undefined> {
    const hit = this.store.get(origin)
    return hit && hit.expiresAt > this.now() ? hit.rules : undefined
  }

  async put(origin: string, rules: RobotsRules, ttlSec: number): Promise<void> {
    this.store.set(origin, { rules, expiresAt: this.now() + ttlSec * 1000 })
  }
}
