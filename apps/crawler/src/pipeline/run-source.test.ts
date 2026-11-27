import { describe, expect, it } from 'vitest'
import { fixtureHtml, harness, NOW, rows, sourceIdOf, VENUE_IDS, type Harness, type VenueId } from './test-support'
import { runSource } from './run-source'

// 2026-11-21 12:00 JST 時点の、各会場の合成フィクスチャの公演数（抽出した件数 − 過去日 − 同じカードの重複）
const EXPECTED: Record<VenueId, { extracted: number; past: number; stored: number; duplicates: number }> = {
  'venue-shimokitazawa-shelter': { extracted: 9, past: 4, stored: 5, duplicates: 0 },
  'venue-shinjuku-loft': { extracted: 13, past: 7, stored: 6, duplicates: 0 },
  'venue-shibuya-duo': { extracted: 11, past: 7, stored: 4, duplicates: 0 },
  'venue-shibuya-womb': { extracted: 6, past: 0, stored: 6, duplicates: 0 },
  'venue-daikanyama-unit': { extracted: 9, past: 5, stored: 3, duplicates: 1 }
}

const count = async (h: Harness, sql: string, ...p: unknown[]): Promise<number> => (await h.db.prepare(sql).bind(...p).first<{ n: number }>())?.n ?? -1
const SHELTER = 'venue-shimokitazawa-shelter' as const
const LOFT = 'venue-shinjuku-loft' as const

async function firstRunAll(h: Harness): Promise<void> {
  for (const v of VENUE_IDS) await runSource(h.deps, sourceIdOf(v))
}

describe('Contract: 初回の実行は 5 会場のフィクスチャから公演を D1 に入れる', () => {
  it.each(VENUE_IDS)('%s: 抽出 → 過去日を除いて保存し、crawl_runs・content_hash・生 HTML を残す', async (venueId) => {
    const h = await harness()
    const result = await runSource(h.deps, sourceIdOf(venueId))
    const want = EXPECTED[venueId]
    expect(result).toMatchObject({ kind: 'done', status: 'stored', error: null })
    expect(result.kind === 'done' && result.summary).toMatchObject({
      extracted: want.extracted,
      skipped_past: want.past,
      skipped_invalid: 0,
      inserted: want.stored,
      duplicates: want.duplicates
    })
    expect(await count(h, 'SELECT COUNT(*) n FROM events WHERE venue_id = ?', venueId)).toBe(want.stored)
    expect(await count(h, 'SELECT COUNT(*) n FROM observations WHERE source_id = ?', sourceIdOf(venueId))).toBe(want.stored)
    // 過去日は 1 件も入っていない
    expect(await count(h, "SELECT COUNT(*) n FROM events WHERE date < '2026-11-21'")).toBe(0)

    const [run] = await rows<Record<string, unknown>>(h.db, 'SELECT * FROM crawl_runs')
    expect(run).toMatchObject({ source_id: sourceIdOf(venueId), started_at: NOW.toISOString(), http_status: 200, changed: 1, error: null })
    expect(run?.['bytes']).toBeGreaterThan(0)

    const [src] = await rows<{ content_hash: string; etag: string; last_status: number }>(
      h.db,
      'SELECT content_hash, etag, last_status FROM sources WHERE id = ?',
      sourceIdOf(venueId)
    )
    expect(src?.content_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(src).toMatchObject({ etag: `"${venueId}"`, last_status: 200 })

    // 生 HTML は raw/<source>/<JST 日付>/<ハッシュ>.html に保存される
    expect([...h.r2.objects.keys()]).toEqual([`raw/${sourceIdOf(venueId)}/2026-11-21/${src?.content_hash}.html`])
    expect([...h.r2.objects.values()][0]).toBe(fixtureHtml(venueId))
    const obs = await rows<{ raw_r2_key: string }>(h.db, 'SELECT DISTINCT raw_r2_key FROM observations')
    expect(obs.map((o) => o.raw_r2_key)).toEqual([...h.r2.objects.keys()])
  })

  // Contract: 全公演に出典 URL と最終確認時刻が付く。時刻は興行日基準の元表記と UTC の両方を持つ
  it('SHELTER: 19:00 開演の公演は start_text と start_at（UTC）を持ち、出典が付く', async () => {
    const h = await harness()
    await runSource(h.deps, sourceIdOf(SHELTER))
    const [e] = await rows<Record<string, unknown>>(h.db, "SELECT * FROM events WHERE date = '2026-11-22' AND title_ja LIKE 'テストバンドD%'")
    expect(e).toMatchObject({ start_text: '19:00', start_at: '2026-11-22T10:00:00.000Z', last_verified_at: NOW.toISOString(), needs_review: 0 })
    expect(String(e?.['source_url'])).toMatch(/^https:\/\//)
  })

  // Contract: 出演者のいない公演（SHELTER の 2 件）だけ needs_review。それ以外は印が付かない
  it('SHELTER: empty_artists の 2 件だけ needs_review', async () => {
    const h = await harness()
    await runSource(h.deps, sourceIdOf(SHELTER))
    expect(await count(h, 'SELECT COUNT(*) n FROM events WHERE needs_review = 1')).toBe(2)
    expect(await count(h, 'SELECT COUNT(*) n FROM events e WHERE needs_review = 1 AND EXISTS (SELECT 1 FROM event_artists WHERE event_id = e.id)')).toBe(0)
  })
})

describe('Contract: 2 回目以降', () => {
  // Contract: 同じ本文の再実行は何も変えない（公演・観測は増えず、updated_at も動かない）。last_verified_at だけ進む
  it('変化なしなら抽出せず、last_verified_at だけ進める', async () => {
    const h = await harness()
    await firstRunAll(h)
    const before = await rows<Record<string, unknown>>(h.db, 'SELECT id, updated_at, last_verified_at FROM events ORDER BY id')
    const obsBefore = await count(h, 'SELECT COUNT(*) n FROM observations')
    const later = new Date('2026-11-21T04:00:00Z') // 同じ日の 1 時間後（今日以降の公演はすべて対象のまま）
    h.clock.now = later
    const results = await Promise.all(VENUE_IDS.map((v) => runSource(h.deps, sourceIdOf(v))))
    expect(results.every((r) => r.kind === 'done' && r.status === 'unchanged')).toBe(true)
    const after = await rows<Record<string, unknown>>(h.db, 'SELECT id, updated_at, last_verified_at FROM events ORDER BY id')
    expect(after.map((e) => e['id'])).toEqual(before.map((e) => e['id']))
    expect(after.map((e) => e['updated_at'])).toEqual(before.map((e) => e['updated_at']))
    expect(after.every((e) => e['last_verified_at'] === later.toISOString())).toBe(true)
    expect(await count(h, 'SELECT COUNT(*) n FROM observations')).toBe(obsBefore)
    expect(await count(h, 'SELECT COUNT(*) n FROM crawl_runs WHERE changed = 0 AND error IS NULL')).toBe(5)
    expect(h.r2.objects.size).toBe(5)
  })

  // Contract: 1 件のタイトルだけ変わったページは、その 1 件だけが更新される（id は変わらず、他は触らない）
  it('本文が変わったら、変わった公演だけ更新する', async () => {
    const h = await harness()
    await runSource(h.deps, sourceIdOf(SHELTER))
    const before = await rows<{ id: string; title_ja: string; updated_at: string }>(h.db, 'SELECT id, title_ja, updated_at FROM events ORDER BY id')
    const html = fixtureHtml(SHELTER)
    expect(html).toContain('テストバンドD 2周年記念ONEMAN LIVE')
    h.web.pages.set(SHELTER, html.replace('テストバンドD 2周年記念ONEMAN LIVE', 'テストバンドD 3周年記念ONEMAN LIVE'))
    h.clock.now = new Date('2026-11-22T03:00:00Z')

    const result = await runSource(h.deps, sourceIdOf(SHELTER))
    expect(result.kind === 'done' && result.summary).toMatchObject({ inserted: 0, updated: 1 })
    const after = await rows<{ id: string; title_ja: string; updated_at: string }>(h.db, 'SELECT id, title_ja, updated_at FROM events ORDER BY id')
    expect(after.map((e) => e.id)).toEqual(before.map((e) => e.id))
    expect(after.filter((e, i) => e.title_ja !== before[i]?.title_ja).map((e) => e.title_ja)).toEqual(['テストバンドD 3周年記念ONEMAN LIVE'])
    expect(after.filter((e, i) => e.updated_at !== before[i]?.updated_at)).toHaveLength(1)
    expect(await count(h, 'SELECT COUNT(*) n FROM crawl_runs WHERE changed = 1')).toBe(2)
    expect(h.r2.objects.size).toBe(2)
  })

  // Contract: 304 は抽出せず、今日以降の公演の last_verified_at だけ進める
  it('304 Not Modified は not_modified として記録する', async () => {
    const h = await harness()
    await runSource(h.deps, sourceIdOf(SHELTER))
    h.web.overrides.set(SHELTER, () => new Response(null, { status: 304 }))
    const later = new Date('2026-11-21T04:00:00Z')
    h.clock.now = later
    expect(await runSource(h.deps, sourceIdOf(SHELTER))).toMatchObject({ kind: 'done', status: 'not_modified' })
    const runs = await rows<{ http_status: number; changed: number; error: string | null }>(h.db, 'SELECT http_status, changed, error FROM crawl_runs ORDER BY id')
    expect(runs[1]).toEqual({ http_status: 304, changed: 0, error: null })
    expect(await count(h, 'SELECT COUNT(*) n FROM events WHERE last_verified_at = ?', later.toISOString())).toBe(5)
  })

  // Contract: 日付が過ぎた公演の last_verified_at は進めない（もう確認する意味がない）
  it('変化なしでも、今日より前の公演は last_verified_at を進めない', async () => {
    const h = await harness()
    await runSource(h.deps, sourceIdOf(SHELTER))
    h.clock.now = new Date('2026-11-24T03:00:00Z') // 11-21〜11-23 の公演は過去になる
    await runSource(h.deps, sourceIdOf(SHELTER))
    const stale = await count(h, "SELECT COUNT(*) n FROM events WHERE date < '2026-11-24' AND last_verified_at = ?", NOW.toISOString())
    const fresh = await count(h, "SELECT COUNT(*) n FROM events WHERE date >= '2026-11-24' AND last_verified_at = ?", h.clock.now.toISOString())
    expect(stale).toBeGreaterThan(0)
    expect(fresh).toBeGreaterThan(0)
    expect(await count(h, "SELECT COUNT(*) n FROM events WHERE date < '2026-11-24' AND last_verified_at != ?", NOW.toISOString())).toBe(0)
  })
})

describe('Contract: 取得の失敗・禁止・設定なし', () => {
  it('429 は retry を返し、Retry-After の秒数と crawl_runs.error を残す', async () => {
    const h = await harness()
    h.web.overrides.set('venue-shibuya-duo', () => new Response('', { status: 429, headers: { 'retry-after': '90' } }))
    expect(await runSource(h.deps, sourceIdOf('venue-shibuya-duo'))).toEqual({ kind: 'retry', afterSec: 90, reason: 'rate_limited' })
    expect(await rows(h.db, 'SELECT error, changed FROM crawl_runs')).toEqual([{ error: 'retry:rate_limited', changed: null }])
    expect(await count(h, 'SELECT COUNT(*) n FROM events')).toBe(0)
  })

  it('再試行の上限（attempt 5）に達したら retry を返さず、枯渇を記録する', async () => {
    const h = await harness()
    h.web.overrides.set('venue-shibuya-duo', () => new Response('', { status: 503 }))
    expect(await runSource(h.deps, sourceIdOf('venue-shibuya-duo'), 5)).toMatchObject({ kind: 'done', status: 'error', error: 'retry_exhausted:server_error' })
  })

  it('404 などの恒久エラーは error として記録して終わる', async () => {
    const h = await harness()
    h.web.overrides.set('venue-shibuya-duo', () => new Response('nope', { status: 404 }))
    expect(await runSource(h.deps, sourceIdOf('venue-shibuya-duo'))).toMatchObject({ kind: 'done', status: 'error', error: 'HTTP 404' })
    expect(await rows(h.db, 'SELECT http_status, error FROM crawl_runs')).toEqual([{ http_status: 404, error: 'HTTP 404' }])
  })

  // Contract: robots が禁止したら取得せず robots_ok=0 にし、以後の対象から外す
  it('robots.txt が禁止なら robots_ok = 0 にして本文を取らない', async () => {
    const h = await harness()
    h.web.robots = 'User-agent: *\nDisallow: /\n'
    expect(await runSource(h.deps, sourceIdOf('venue-shibuya-duo'))).toMatchObject({ kind: 'done', status: 'blocked', error: 'robots:disallowed' })
    expect(await rows(h.db, 'SELECT robots_ok FROM sources WHERE id = ?', sourceIdOf('venue-shibuya-duo'))).toEqual([{ robots_ok: 0 }])
    expect(await rows(h.db, 'SELECT error FROM crawl_runs')).toEqual([{ error: 'robots:disallowed' }])
    expect(h.web.requests.every((u) => u.endsWith('/robots.txt'))).toBe(true)
  })

  // Contract: 設定が無い source は取得もしない
  it('config_json が無ければ no_config を記録し、何も取得しない', async () => {
    const h = await harness()
    await h.db.prepare('UPDATE sources SET config_json = NULL WHERE id = ?').bind(sourceIdOf('venue-shibuya-duo')).run()
    expect(await runSource(h.deps, sourceIdOf('venue-shibuya-duo'))).toMatchObject({ kind: 'done', status: 'no_config', error: 'no_config' })
    expect(h.web.requests).toEqual([])
    expect(await rows(h.db, 'SELECT error FROM crawl_runs')).toEqual([{ error: 'no_config' }])
  })

  it('壊れた設定は invalid_config、未知の source は何も書かない', async () => {
    const h = await harness()
    await h.db.prepare("UPDATE sources SET config_json = '{\"version\":2}' WHERE id = ?").bind(sourceIdOf('venue-shibuya-duo')).run()
    expect(await runSource(h.deps, sourceIdOf('venue-shibuya-duo'))).toMatchObject({ status: 'invalid_config' })
    expect(await runSource(h.deps, 'src_nope')).toMatchObject({ status: 'unknown_source' })
    expect(await count(h, 'SELECT COUNT(*) n FROM crawl_runs')).toBe(1)
  })
})

describe('Contract: 件数の急減は何も壊さない（T12 の簡易版）', () => {
  const EMPTY = '<!doctype html><html><body><p>メンテナンス中</p></body></html>'

  // Contract: 前回あった公演が 0 件になったら count_drop。公演は消さず、content_hash・etag も進めない（次回も検知できる）
  it('0 件になったら count_drop を記録し、既存の公演・ハッシュは触らない', async () => {
    const h = await harness()
    await runSource(h.deps, sourceIdOf(SHELTER))
    const [src] = await rows<{ content_hash: string; etag: string }>(h.db, 'SELECT content_hash, etag FROM sources WHERE id = ?', sourceIdOf(SHELTER))
    const eventsBefore = await rows(h.db, 'SELECT * FROM events ORDER BY id')
    h.web.overrides.set(SHELTER, () => new Response(EMPTY, { status: 200, headers: { etag: '"new"' } }))
    h.clock.now = new Date('2026-11-22T03:00:00Z')

    expect(await runSource(h.deps, sourceIdOf(SHELTER))).toMatchObject({ kind: 'done', status: 'count_drop', error: 'count_drop' })
    expect(await rows(h.db, 'SELECT * FROM events ORDER BY id')).toEqual(eventsBefore)
    expect(await rows(h.db, 'SELECT content_hash, etag FROM sources WHERE id = ?', sourceIdOf(SHELTER))).toEqual([src])
    const runs = await rows<{ changed: number; error: string | null }>(h.db, 'SELECT changed, error FROM crawl_runs ORDER BY id')
    expect(runs[1]).toEqual({ changed: 1, error: 'count_drop' })
  })

  // Contract: 半分未満に減ったページも同様に何も書かない
  it('半分未満に減ったら count_drop で、公演は 6 件のまま', async () => {
    const h = await harness()
    await runSource(h.deps, sourceIdOf(LOFT))
    const cards = fixtureHtml(LOFT).split('<div class="column')
    expect(cards.length).toBeGreaterThan(10)
    // 先頭の 3 カードだけ残す（13 公演 → 2 公演。1 枚はメンテナンスで skip）
    h.web.pages.set(LOFT, cards.slice(0, 4).join('<div class="column'))
    h.clock.now = new Date('2026-11-22T03:00:00Z')
    expect(await runSource(h.deps, sourceIdOf(LOFT))).toMatchObject({ status: 'count_drop' })
    expect(await count(h, 'SELECT COUNT(*) n FROM events')).toBe(6)
  })

  // Contract: 初回から 0 件のページは no_events を記録するだけで、ハッシュを保存しない（次回も再評価される）
  it('初回から公演が取れないページは no_events で、content_hash を残さない', async () => {
    const h = await harness()
    h.web.pages.set(SHELTER, EMPTY)
    expect(await runSource(h.deps, sourceIdOf(SHELTER))).toMatchObject({ status: 'no_events', error: 'no_events' })
    expect(await rows(h.db, 'SELECT content_hash FROM sources WHERE id = ?', sourceIdOf(SHELTER))).toEqual([{ content_hash: null }])
  })
})
