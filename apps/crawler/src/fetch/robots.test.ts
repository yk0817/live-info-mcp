import { describe, expect, it } from 'vitest'
import { InMemoryRobotsCache, isAllowedByRules, parseRobots, WorkersRobotsCache } from './robots'
import { INITIAL_GATE_STATE, reserveSlot } from './domain-schedule'
import { buildUserAgent } from './config'

describe('parseRobots / isAllowedByRules', () => {
  // Contract: a group naming our product wins over `*`.
  it('prefers our specific group over *', () => {
    const rules = parseRobots('User-agent: *\nDisallow: /\n\nUser-agent: live-info-mcp-crawler\nDisallow: /admin\n')
    expect(isAllowedByRules(rules, '/schedule')).toBe(true)
    expect(isAllowedByRules(rules, '/admin/x')).toBe(false)
  })

  it('falls back to * and reads Crawl-delay', () => {
    const rules = parseRobots('User-agent: *\nCrawl-delay: 10\nDisallow: /tmp\n')
    expect(rules.crawlDelaySec).toBe(10)
    expect(isAllowedByRules(rules, '/tmp/a')).toBe(false)
  })

  // Contract: longest match wins; Allow wins ties.
  it('uses longest match and Allow-on-tie', () => {
    const rules = parseRobots('User-agent: *\nDisallow: /events\nAllow: /events/public\nDisallow: /x\nAllow: /x\n')
    expect(isAllowedByRules(rules, '/events/private')).toBe(false)
    expect(isAllowedByRules(rules, '/events/public/1')).toBe(true)
    expect(isAllowedByRules(rules, '/x')).toBe(true)
  })

  it('supports * and $ wildcards, ignores comments and empty Disallow', () => {
    const rules = parseRobots('User-agent: *  # all\nDisallow: /*.pdf$\nDisallow:\n')
    expect(isAllowedByRules(rules, '/a/b.pdf')).toBe(false)
    expect(isAllowedByRules(rules, '/a/b.pdf?x=1')).toBe(true)
    expect(isAllowedByRules(parseRobots('User-agent: *\nDisallow:\n'), '/anything')).toBe(true)
  })

  it('matches several User-agent lines to one group and allows everything when no group matches', () => {
    const rules = parseRobots('User-agent: foo\nUser-agent: live-info-mcp-crawler\nDisallow: /a\n')
    expect(isAllowedByRules(rules, '/a')).toBe(false)
    expect(isAllowedByRules(parseRobots('User-agent: foo\nDisallow: /\n'), '/a')).toBe(true)
  })
})

describe('robots cache', () => {
  it('in-memory cache expires after the ttl', async () => {
    let now = 0
    const cache = new InMemoryRobotsCache(() => now)
    await cache.put('https://a', { rules: [], crawlDelaySec: null }, 10)
    expect(await cache.get('https://a')).toBeDefined()
    now = 10_001
    expect(await cache.get('https://a')).toBeUndefined()
  })

  it('Workers cache implementation round-trips via the Cache API with max-age', async () => {
    const store = new Map<string, Response>()
    const fake = {
      match: async (req: Request) => store.get(req.url)?.clone(),
      put: async (req: Request, res: Response) => void store.set(req.url, res)
    } as unknown as Cache
    const cache = new WorkersRobotsCache(fake)
    expect(await cache.get('https://a.test')).toBeUndefined()
    await cache.put('https://a.test', { rules: [{ allow: false, pattern: '/x' }], crawlDelaySec: 3 }, 86400)
    expect(await cache.get('https://a.test')).toEqual({ rules: [{ allow: false, pattern: '/x' }], crawlDelaySec: 3 })
    expect([...store.values()][0]?.headers.get('cache-control')).toBe('max-age=86400')
  })
})

describe('reserveSlot (fake clock)', () => {
  // Contract: >= 5s between consecutive requests to one domain, even when reserved concurrently.
  it('first request is immediate; later ones are spaced by 5s', () => {
    const a = reserveSlot(INITIAL_GATE_STATE, 1000)
    expect(a.waitMs).toBe(0)
    const b = reserveSlot(a.next, 1000)
    expect(b.waitMs).toBe(5000)
    const c = reserveSlot(b.next, 1000)
    expect(c.waitMs).toBe(10000)
  })

  it('does not wait once enough time has passed', () => {
    const a = reserveSlot(INITIAL_GATE_STATE, 0)
    expect(reserveSlot(a.next, 5000).waitMs).toBe(0)
    expect(reserveSlot(a.next, 4000).waitMs).toBe(1000)
  })

  it('honors a larger Crawl-delay for the following slot', () => {
    const a = reserveSlot(INITIAL_GATE_STATE, 0, 20)
    expect(reserveSlot(a.next, 0, 20).waitMs).toBe(20000)
  })

  it('does not mutate the previous state', () => {
    const before = { nextAllowedAt: 100 }
    reserveSlot(before, 0)
    expect(before).toEqual({ nextAllowedAt: 100 })
  })
})

describe('buildUserAgent', () => {
  it('uses the configured contact URL, or a placeholder', () => {
    expect(buildUserAgent('https://x.test/c')).toBe('live-info-mcp-crawler/0.1 (+https://x.test/c)')
    expect(buildUserAgent(undefined)).toBe('live-info-mcp-crawler/0.1 (+https://example.com/crawler)')
    expect(buildUserAgent('  ')).toBe('live-info-mcp-crawler/0.1 (+https://example.com/crawler)')
  })
})
