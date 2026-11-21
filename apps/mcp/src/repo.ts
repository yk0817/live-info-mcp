// D1 からの読み取り専用アクセス。SQL は全てパラメタライズし、素のオブジェクトだけを返す。
// 言語切り替えや文面の整形は呼び出し側（tools.ts）の責務で、ここでは持たない。

export const MAX_LIMIT = 50
export const DEFAULT_LIMIT = 20

export type EventStatus = 'upcoming' | 'on_sale' | 'sold_out' | 'cancelled'
export type ArtistRole = 'headliner' | 'support' | 'guest'
export type VenueKind = 'livehouse' | 'club'

export interface EventArtistRow {
  id: string
  name_ja: string | null
  name_en: string | null
  role: ArtistRole
}

export interface EventRow {
  id: string
  date: string
  open_time: string | null
  start_at: string | null
  start_text: string | null
  title_ja: string
  title_en: string | null
  price_text: string | null
  price_min_jpy: number | null
  status: EventStatus | null
  ticket_url: string | null
  source_url: string
  last_verified_at: string
  needs_review: boolean
  venue: { id: string; name_ja: string; name_en: string | null }
  artists: EventArtistRow[]
}

export interface VenueRow {
  id: string
  name_ja: string
  name_en: string | null
  venue_kind: VenueKind
  city: string | null
  official_url: string | null
  capacity: number | null
  nearest_station: string | null
}

export interface SearchEventsQuery {
  keyword?: string | undefined
  venue?: string | undefined
  date_from: string
  date_to: string
  limit?: number | undefined
}

export interface SearchVenuesQuery {
  name?: string | undefined
  kind?: VenueKind | undefined
  limit?: number | undefined
}

export function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_LIMIT
  return Math.min(MAX_LIMIT, Math.max(1, Math.trunc(limit)))
}

// `%` `_` `\` をリテラル扱いにして部分一致パターンを作る（SQL 側は ESCAPE '\'）。
export function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
}

interface EventDbRow {
  id: string
  date: string
  open_time: string | null
  start_at: string | null
  start_text: string | null
  title_ja: string
  title_en: string | null
  price_text: string | null
  price_min_jpy: number | null
  status: EventStatus | null
  ticket_url: string | null
  source_url: string
  last_verified_at: string
  needs_review: number
  venue_id: string
  venue_name_ja: string
  venue_name_en: string | null
}

interface ArtistDbRow extends EventArtistRow {
  event_id: string
}

const EVENT_SELECT = `
  SELECT e.id, e.date, e.open_time, e.start_at, e.start_text, e.title_ja, e.title_en,
         e.price_text, e.price_min_jpy, e.status, e.ticket_url, e.source_url,
         e.last_verified_at, e.needs_review,
         v.id AS venue_id, v.name_ja AS venue_name_ja, v.name_en AS venue_name_en
  FROM events e JOIN venues v ON v.id = e.venue_id`

async function attachArtists(db: D1Database, rows: EventDbRow[]): Promise<EventRow[]> {
  if (rows.length === 0) return []
  const ids = rows.map((r) => r.id)
  const { results } = await db
    .prepare(
      `SELECT ea.event_id, a.id, a.name_ja, a.name_en, ea.role
       FROM event_artists ea JOIN artists a ON a.id = ea.artist_id
       WHERE ea.event_id IN (${ids.map(() => '?').join(',')})
       ORDER BY ea.event_id, ea.billing_order IS NULL, ea.billing_order, a.id`
    )
    .bind(...ids)
    .all<ArtistDbRow>()
  const byEvent = new Map<string, EventArtistRow[]>()
  for (const { event_id, ...artist } of results) {
    byEvent.set(event_id, [...(byEvent.get(event_id) ?? []), artist])
  }
  return rows.map((r) => ({
    id: r.id,
    date: r.date,
    open_time: r.open_time,
    start_at: r.start_at,
    start_text: r.start_text,
    title_ja: r.title_ja,
    title_en: r.title_en,
    price_text: r.price_text,
    price_min_jpy: r.price_min_jpy,
    status: r.status,
    ticket_url: r.ticket_url,
    source_url: r.source_url,
    last_verified_at: r.last_verified_at,
    needs_review: r.needs_review === 1,
    venue: { id: r.venue_id, name_ja: r.venue_name_ja, name_en: r.venue_name_en },
    artists: byEvent.get(r.id) ?? []
  }))
}

export interface EventSearchResult {
  events: EventRow[]
  has_more: boolean
}

// limit + 1 件取って、続きがあるかだけ返す（件数の COUNT は別クエリにしない）。
export async function searchEvents(db: D1Database, q: SearchEventsQuery): Promise<EventSearchResult> {
  const limit = clampLimit(q.limit)
  const where = ['e.date >= ?', 'e.date <= ?']
  const params: (string | number)[] = [q.date_from, q.date_to]

  if (q.keyword) {
    const p = likePattern(q.keyword)
    where.push(`(e.title_ja LIKE ? ESCAPE '\\' OR e.title_en LIKE ? ESCAPE '\\' OR EXISTS (
      SELECT 1 FROM event_artists ea JOIN artists a ON a.id = ea.artist_id
      WHERE ea.event_id = e.id AND (a.name_ja LIKE ? ESCAPE '\\' OR a.name_en LIKE ? ESCAPE '\\')))`)
    params.push(p, p, p, p)
  }
  if (q.venue) {
    const p = likePattern(q.venue)
    where.push(`(v.id = ? OR v.name_ja LIKE ? ESCAPE '\\' OR v.name_en LIKE ? ESCAPE '\\')`)
    params.push(q.venue, p, p)
  }

  const { results } = await db
    .prepare(
      `${EVENT_SELECT} WHERE ${where.join(' AND ')}
       ORDER BY e.date, e.start_at IS NULL, e.start_at, e.id LIMIT ?`
    )
    .bind(...params, limit + 1)
    .all<EventDbRow>()
  const rows = await attachArtists(db, results.slice(0, limit))
  return { events: rows, has_more: results.length > limit }
}

export async function getEvent(db: D1Database, id: string): Promise<EventRow | null> {
  const { results } = await db.prepare(`${EVENT_SELECT} WHERE e.id = ?`).bind(id).all<EventDbRow>()
  return (await attachArtists(db, results))[0] ?? null
}

export async function searchVenues(db: D1Database, q: SearchVenuesQuery): Promise<VenueRow[]> {
  const where: string[] = []
  const params: (string | number)[] = []
  if (q.name) {
    const p = likePattern(q.name)
    where.push(`(name_ja LIKE ? ESCAPE '\\' OR name_en LIKE ? ESCAPE '\\')`)
    params.push(p, p)
  }
  if (q.kind) {
    where.push('venue_kind = ?')
    params.push(q.kind)
  }
  const { results } = await db
    .prepare(
      `SELECT id, name_ja, name_en, venue_kind, city, official_url, capacity, nearest_station
       FROM venues ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY name_ja, id LIMIT ?`
    )
    .bind(...params, clampLimit(q.limit))
    .all<VenueRow>()
  return results
}
