import type { ArtistLink, ExistingEvent, Role } from './types'
import { artistIdFor } from './ids'
import { isJapaneseName, normalizeName } from './names'

const NAME_CHUNK = 25

const placeholders = (n: number): string => Array.from({ length: n }, () => '?').join(',')

interface ArtistRow {
  id: string
  name_ja: string | null
  name_en: string | null
}

export interface ResolvedArtists {
  // 正規化した名前 → artist id
  ids: ReadonlyMap<string, string>
  // 新規作成が必要なもの（INSERT OR IGNORE で冪等）
  created: readonly { id: string; name_ja: string | null; name_en: string | null }[]
}

// 既存の artists を正規化した名前で引き、無ければ決定的な id で新規扱いにする。本格的な名寄せは T10。
export async function resolveArtists(db: D1Database, rawNames: readonly string[]): Promise<ResolvedArtists> {
  const byNorm = new Map<string, string>() // 正規化名 → 元の表記（最初のもの）
  for (const raw of rawNames) {
    const norm = normalizeName(raw)
    if (norm !== '' && !byNorm.has(norm)) byNorm.set(norm, raw.trim())
  }
  const norms = [...byNorm.keys()]
  const detIds = new Map<string, string>()
  for (const norm of norms) detIds.set(norm, await artistIdFor(norm))

  const found = new Map<string, string>()
  for (let i = 0; i < norms.length; i += NAME_CHUNK) {
    const chunk = norms.slice(i, i + NAME_CHUNK)
    const idsChunk = chunk.map((n) => detIds.get(n) as string)
    const { results } = await db
      .prepare(
        `SELECT id, name_ja, name_en FROM artists
         WHERE id IN (${placeholders(chunk.length)})
            OR lower(name_ja) IN (${placeholders(chunk.length)})
            OR lower(name_en) IN (${placeholders(chunk.length)})
         ORDER BY id`
      )
      .bind(...idsChunk, ...chunk, ...chunk)
      .all<ArtistRow>()
    for (const row of results) {
      for (const name of [row.name_ja, row.name_en]) {
        if (name === null) continue
        const norm = normalizeName(name)
        if (byNorm.has(norm) && !found.has(norm)) found.set(norm, row.id)
      }
    }
  }

  const ids = new Map<string, string>()
  const created: { id: string; name_ja: string | null; name_en: string | null }[] = []
  for (const norm of norms) {
    const hit = found.get(norm)
    if (hit !== undefined) {
      ids.set(norm, hit)
      continue
    }
    const id = detIds.get(norm) as string
    ids.set(norm, id)
    const original = byNorm.get(norm) as string
    created.push(isJapaneseName(original) ? { id, name_ja: original, name_en: null } : { id, name_ja: null, name_en: original })
  }
  return { ids, created }
}

interface EventRow extends Omit<ExistingEvent, 'startNorm' | 'artists'> {
  start_text: string | null
}

// 会場の date 範囲にある既存公演を出演者つきで読む（同一判定の候補）
export async function loadExisting(db: D1Database, venueId: string, minDate: string, maxDate: string): Promise<ExistingEvent[]> {
  const { results: events } = await db
    .prepare(
      `SELECT id, date, title_ja, title_en, open_time, start_at, start_text, price_text, price_min_jpy,
              status, ticket_url, source_url, fingerprint, needs_review, first_seen_at
       FROM events WHERE venue_id = ? AND date BETWEEN ? AND ? ORDER BY id`
    )
    .bind(venueId, minDate, maxDate)
    .all<EventRow>()
  if (events.length === 0) return []
  const { results: links } = await db
    .prepare(
      `SELECT event_id, artist_id, role, billing_order FROM event_artists
       WHERE event_id IN (SELECT id FROM events WHERE venue_id = ? AND date BETWEEN ? AND ?)
       ORDER BY event_id, billing_order IS NULL, billing_order, artist_id`
    )
    .bind(venueId, minDate, maxDate)
    .all<{ event_id: string; artist_id: string; role: Role; billing_order: number | null }>()
  const byEvent = new Map<string, ArtistLink[]>()
  for (const l of links) {
    const list = byEvent.get(l.event_id) ?? []
    byEvent.set(l.event_id, [...list, { artistId: l.artist_id, role: l.role, order: l.billing_order ?? list.length }])
  }
  return events.map((e) => ({ ...e, startNorm: normalizeName(e.start_text ?? ''), artists: byEvent.get(e.id) ?? [] }))
}
