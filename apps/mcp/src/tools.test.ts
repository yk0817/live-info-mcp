import { beforeAll, describe, expect, it } from 'vitest'
import { callTool, seededDb, type ToolResult } from './test-helpers'

let db: D1Database
beforeAll(async () => {
  db = await seededDb()
})

// 2026-11-21 23:59:59 JST と 2026-11-22 00:00:00 JST
const beforeMidnight = () => new Date('2026-11-21T14:59:59Z')
const afterMidnight = () => new Date('2026-11-21T15:00:00Z')

type EventOut = { id: string; date: string; start_text: string | null; venue: { id: string; name: string; name_ja?: string }; title: string; title_ja?: string; artists: { name: string; name_ja?: string; role: string }[]; needs_review: boolean; status: string | null; source_url: string; last_verified_at: string }
const search = async (args: Record<string, unknown>, clock = beforeMidnight): Promise<{ r: ToolResult; events: EventOut[] }> => {
  const r = await callTool(db, clock, 'search_events', args)
  return { r, events: (r.structuredContent?.events ?? []) as EventOut[] }
}
const ids = (events: EventOut[]): string[] => events.map((e) => e.id)

describe('search_events', () => {
  // Contract: the default window is today..today+30 in JST, evaluated from the injected clock.
  it('uses JST today as the start of the default window, across the midnight boundary', async () => {
    const before = await search({})
    expect(before.r.structuredContent).toMatchObject({ date_from: '2026-11-21', date_to: '2026-12-21' })
    expect(ids(before.events)).toEqual(['e-today', 'e-late', 'e-pct', 'e-plain'])

    const after = await search({}, afterMidnight)
    expect(after.r.structuredContent).toMatchObject({ date_from: '2026-11-22', date_to: '2026-12-22' })
    expect(ids(after.events)).toEqual(['e-late', 'e-pct', 'e-plain'])
  })

  // Contract: explicit dates override the default; a lone date_from carries a 30-day window.
  it('honours explicit dates and rejects an inverted or invalid range as a tool error', async () => {
    expect(ids((await search({ date_from: '2026-12-01', date_to: '2026-12-31' })).events)).toEqual(['e-far'])
    expect((await search({ date_from: '2026-12-01' })).r.structuredContent).toMatchObject({ date_to: '2026-12-31' })
    const inverted = await search({ date_from: '2026-12-02', date_to: '2026-12-01' })
    expect(inverted.r.isError).toBe(true)
    const invalid = await search({ date_from: '2026-02-30' })
    expect(invalid.r.isError).toBe(true)
  })

  // Contract: keyword matches the event title (ja/en) and artist names (ja/en).
  it('matches keyword against titles and artist names', async () => {
    expect(ids((await search({ keyword: '深夜' })).events)).toEqual(['e-late'])
    expect(ids((await search({ keyword: 'late night' })).events)).toEqual(['e-late'])
    expect(ids((await search({ keyword: 'ミツメ' })).events)).toEqual(['e-today', 'e-late'])
    expect(ids((await search({ keyword: 'dj foo' })).events)).toEqual(['e-late'])
    expect((await search({ keyword: 'nonexistent' })).events).toEqual([])
  })

  // Contract: LIKE wildcards in user input are literals, so '%' and '_' cannot match everything.
  it('escapes LIKE wildcards in keyword', async () => {
    expect(ids((await search({ keyword: '%' })).events)).toEqual(['e-pct', 'e-plain'])
    expect(ids((await search({ keyword: '_' })).events)).toEqual(['e-pct'])
    expect(ids((await search({ keyword: '100%の' })).events)).toEqual(['e-pct'])
  })

  // Contract: venue filters by exact id or by name substring (ja or en).
  it('filters by venue id or name substring', async () => {
    expect(ids((await search({ venue: 'v-womb' })).events)).toEqual(['e-late'])
    expect(ids((await search({ venue: 'womb' })).events)).toEqual(['e-late'])
    expect(ids((await search({ venue: 'SHELTER' })).events)).toEqual(['e-today', 'e-pct', 'e-plain'])
  })

  // Contract: limit above 50 is capped at 50; has_more says whether results were cut.
  it('caps limit at 50 and reports has_more', async () => {
    const big = (await seededDb())
    const stmts = Array.from({ length: 60 }, (_, i) =>
      big.prepare(`INSERT INTO events (id, venue_id, date, title_ja, first_seen_at, updated_at, source_url, last_verified_at) VALUES (?, 'v-shelter', '2026-11-25', ?, 'x', 'x', 'https://s.example', 'x')`).bind(`bulk-${String(i).padStart(2, '0')}`, `bulk ${i}`)
    )
    await big.batch(stmts)
    const r = await callTool(big, beforeMidnight, 'search_events', { limit: 999 })
    expect(r.structuredContent).toMatchObject({ count: 50, has_more: true })
    const small = await callTool(big, beforeMidnight, 'search_events', { limit: 2 })
    expect(small.structuredContent).toMatchObject({ count: 2, has_more: true })
    const rest = await callTool(big, beforeMidnight, 'search_events', { keyword: '深夜' })
    expect(rest.structuredContent).toMatchObject({ count: 1, has_more: false })
  })

  // Contract: every event carries provenance, the display start text (original notation) and needs_review.
  it('returns the summary fields without inventing data', async () => {
    const { events } = await search({})
    const late = events.find((e) => e.id === 'e-late')
    expect(late).toMatchObject({
      date: '2026-11-22',
      start_text: '24:30',
      venue: { id: 'v-womb', name: '渋谷WOMB' },
      status: 'on_sale',
      needs_review: true,
      source_url: 'https://womb.example/s',
      last_verified_at: '2026-11-20T00:00:00.000Z'
    })
    expect(late?.artists).toEqual([
      expect.objectContaining({ name: 'DJ Foo', role: 'headliner' }),
      expect.objectContaining({ name: 'ミツメ', role: 'guest' })
    ])
    // start_text missing but start_at present: converted back to the show-day notation, not guessed.
    expect(events.find((e) => e.id === 'e-today')?.start_text).toBe('18:30')
    expect(events.find((e) => e.id === 'e-pct')?.start_text).toBeNull()
    expect(events.find((e) => e.id === 'e-today')?.needs_review).toBe(false)
  })

  // Contract: lang=en shows English names first with the Japanese name alongside; ja mode is plain Japanese.
  it('renders English names first with Japanese alongside in en mode', async () => {
    const en = (await search({ lang: 'en', keyword: '深夜' })).events[0]
    expect(en).toMatchObject({
      title: 'Late Night Party',
      title_ja: '深夜パーティー',
      venue: { id: 'v-womb', name: 'WOMB', name_ja: '渋谷WOMB' }
    })
    expect(en?.artists[0]).toMatchObject({ name: 'DJ Foo' })
    expect(en?.artists[1]).toMatchObject({ name: 'Mitsume', name_ja: 'ミツメ' })
    const ja = (await search({ keyword: '深夜' })).events[0]
    expect(ja).toMatchObject({ title: '深夜パーティー', venue: { name: '渋谷WOMB' } })
    expect(ja).not.toHaveProperty('title_ja')
    // No English name available: falls back to Japanese without a duplicate.
    const shelter = (await search({ lang: 'en', venue: 'v-shelter', keyword: 'ミツメ' })).events[0]
    expect(shelter?.venue).toEqual({ id: 'v-shelter', name: '下北沢SHELTER' })
  })

  // Contract: a text content block summarises results alongside structuredContent.
  it('also returns a short text summary', async () => {
    const r = await callTool(db, beforeMidnight, 'search_events', { keyword: '深夜' })
    expect(r.content[0]?.text).toContain('2026-11-22 24:30')
    expect(r.content[0]?.text).toContain('needs_review')
  })
})

describe('get_event', () => {
  // Contract: detail adds open_time, price_text, price_min_jpy; unknown values stay null.
  it('returns detail with nullable fields kept null', async () => {
    const r = await callTool(db, beforeMidnight, 'get_event', { event_id: 'e-late' })
    expect(r.isError).toBeFalsy()
    expect(r.structuredContent?.event).toMatchObject({ id: 'e-late', open_time: '23:00', price_text: '3000円', price_min_jpy: 3000, needs_review: true })
    const bare = await callTool(db, beforeMidnight, 'get_event', { event_id: 'e-far' })
    expect(bare.structuredContent?.event).toMatchObject({ open_time: null, price_text: null, price_min_jpy: null, status: null, ticket_url: null })
  })

  // Contract: an unknown id is a tool error result (isError), not a protocol failure or an empty success.
  it('reports a missing event as an error result', async () => {
    const r = await callTool(db, beforeMidnight, 'get_event', { event_id: 'nope' })
    expect(r.isError).toBe(true)
    expect(r.content[0]?.text).toContain('event not found: nope')
  })

  it('supports lang=en', async () => {
    const r = await callTool(db, beforeMidnight, 'get_event', { event_id: 'e-late', lang: 'en' })
    expect(r.structuredContent?.event).toMatchObject({ title: 'Late Night Party', title_ja: '深夜パーティー' })
  })
})

describe('search_venues', () => {
  type VenueOut = { id: string; name_ja: string; name_en: string | null; venue_kind: string; capacity: number | null; official_url: string | null }
  const venues = async (args: Record<string, unknown>): Promise<VenueOut[]> =>
    ((await callTool(db, beforeMidnight, 'search_venues', args)).structuredContent?.venues ?? []) as VenueOut[]

  // Contract: unknown capacity is null, never a guess; known capacity is returned as is.
  it('keeps unknown capacity null', async () => {
    const all = await venues({})
    expect(all.find((v) => v.id === 'v-shelter')).toMatchObject({ capacity: null, official_url: null, name_en: null })
    expect(all.find((v) => v.id === 'v-womb')).toMatchObject({ capacity: 1000 })
  })

  it('filters by name substring (ja or en) and kind', async () => {
    expect((await venues({ name: 'womb' })).map((v) => v.id)).toEqual(['v-womb'])
    expect((await venues({ name: '下北' })).map((v) => v.id)).toEqual(['v-shelter'])
    expect((await venues({ kind: 'club' })).map((v) => v.id)).toEqual(['v-womb'])
    expect(await venues({ name: '%' })).toEqual([])
  })
})
