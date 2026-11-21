// テスト専用: パイプラインの統合テストで使う偽物（R2・時計・HTTP）とシード済み D1。
/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createMigratedDb } from '../../../../test-utils/d1'
import type { RawBucket } from '../change'
import { InMemoryRobotsCache } from '../fetch'
import type { RunDeps } from './run-source'

const repo = (path: string): string => resolve(import.meta.dirname, '../../../..', path)
const read = (path: string): string => readFileSync(repo(path), 'utf8')

// 2026-11-21 12:00 JST（フィクスチャを取得した日）
export const NOW = new Date('2026-11-21T03:00:00Z')

export const VENUE_IDS = [
  'venue-shimokitazawa-shelter',
  'venue-shinjuku-loft',
  'venue-shibuya-duo',
  'venue-shibuya-womb',
  'venue-daikanyama-unit'
] as const
export type VenueId = (typeof VENUE_IDS)[number]

export const fixtureHtml = (venueId: VenueId): string => read(`apps/crawler/fixtures/${venueId}/schedule.html`)

export async function seedAll(db: D1Database): Promise<void> {
  for (const f of ['seeds/venues.sql', 'seeds/sources.sql', 'seeds/source-configs.sql']) await db.exec(read(f))
}

export class FakeR2 implements RawBucket {
  readonly objects = new Map<string, string>()
  async head(key: string): Promise<unknown | null> {
    return this.objects.has(key) ? {} : null
  }
  async put(key: string, value: string): Promise<unknown> {
    this.objects.set(key, value)
    return {}
  }
}

// どの URL がどの会場のフィクスチャか（url_template で埋めた月別 URL も含む）
function venueOf(url: URL): VenueId | null {
  if (url.pathname.startsWith('/schedule/shelter/')) return 'venue-shimokitazawa-shelter'
  if (url.pathname.startsWith('/schedule/loft/')) return 'venue-shinjuku-loft'
  if (url.hostname.endsWith('duomusicexchange.com')) return 'venue-shibuya-duo'
  if (url.hostname.endsWith('womb.co.jp')) return 'venue-shibuya-womb'
  if (url.hostname.endsWith('unit-tokyo.com')) return 'venue-daikanyama-unit'
  return null
}

export interface FakeWeb {
  pages: Map<VenueId, string>
  // 会場ごとに本文の代わりに返す応答（304・429・500 など）
  overrides: Map<VenueId, () => Response>
  robots: string | null
  requests: string[]
  fetch: typeof fetch
}

export function fakeWeb(): FakeWeb {
  const web: FakeWeb = {
    pages: new Map(VENUE_IDS.map((v) => [v, fixtureHtml(v)])),
    overrides: new Map(),
    robots: null,
    requests: [],
    fetch: async (input) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
      web.requests.push(url.href)
      if (url.pathname === '/robots.txt') {
        return web.robots === null ? new Response('not found', { status: 404 }) : new Response(web.robots)
      }
      const venue = venueOf(url)
      if (venue === null) return new Response('not found', { status: 404 })
      const override = web.overrides.get(venue)
      if (override) return override()
      return new Response(web.pages.get(venue) ?? '', { status: 200, headers: { 'content-type': 'text/html', etag: `"${venue}"` } })
    }
  }
  return web
}

export interface Harness {
  db: D1Database
  r2: FakeR2
  web: FakeWeb
  clock: { now: Date }
  deps: RunDeps
}

export async function harness(): Promise<Harness> {
  const db = createMigratedDb()
  await seedAll(db)
  const r2 = new FakeR2()
  const web = fakeWeb()
  const clock = { now: NOW }
  const deps: RunDeps = {
    db,
    bucket: r2,
    now: () => clock.now,
    fetch: {
      fetch: (input, init) => web.fetch(input, init),
      gate: { reserve: async () => ({ waitMs: 0 }) },
      robotsCache: new InMemoryRobotsCache(() => clock.now.getTime()),
      sleep: async () => {},
      now: () => clock.now.getTime(),
      userAgent: 'test-agent/0.1 (+https://example.invalid)'
    }
  }
  return { db, r2, web, clock, deps }
}

export const sourceIdOf = (venueId: VenueId): string => `src_${venueId}`

export async function rows<T>(db: D1Database, sql: string, ...params: unknown[]): Promise<T[]> {
  return (await db.prepare(sql).bind(...params).all<T>()).results
}
