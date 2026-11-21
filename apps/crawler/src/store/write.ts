import { parseShowTime } from '@live-info/schema'
import { eventIdFor, fingerprintFor } from './ids'
import { normalizeName } from './names'
import { planEvents } from './plan'
import { loadExisting, resolveArtists } from './repo'
import type { AcceptedEvent, ArtistLink, PreparedEvent, StoreSummary, WriteOp } from './types'

// D1 の batch は 1 回に載せる件数を抑える（巨大な 1 リクエストを避ける）。失敗しても再実行で同じ結果になる
const BATCH_SIZE = 40

export interface StoreInput {
  db: D1Database
  venueId: string
  sourceId: string
  rawKey: string | null
  now: Date
  events: readonly AcceptedEvent[]
}

async function prepare(venueId: string, accepted: readonly AcceptedEvent[], artistIds: ReadonlyMap<string, string>): Promise<PreparedEvent[]> {
  return Promise.all(
    accepted.map(async ({ event, needsReview }): Promise<PreparedEvent> => {
      const seen = new Set<string>()
      const artists: ArtistLink[] = []
      for (const a of event.artists) {
        const id = artistIds.get(normalizeName(a.name))
        if (id === undefined || seen.has(id)) continue
        seen.add(id)
        const order = artists.length
        artists.push({ artistId: id, role: a.role ?? (order === 0 ? 'headliner' : 'support'), order })
      }
      const headliner = event.artists[0]?.name ?? null
      const startAt = event.start_text === null ? null : (() => {
        const parsed = parseShowTime(event.date, event.start_text)
        return parsed.ok ? parsed.start_at : null
      })()
      return {
        event,
        needsReview,
        id: await eventIdFor(venueId, event.date, event.start_text, event.title_ja),
        fingerprint: await fingerprintFor(venueId, event.date, event.start_text, headliner),
        startNorm: normalizeName(event.start_text ?? ''),
        startAt,
        artists
      }
    })
  )
}

function statementsFor(input: StoreInput, op: Exclude<WriteOp, { kind: 'duplicate' }>): D1PreparedStatement[] {
  const { db, venueId, sourceId, rawKey, now } = input
  const at = now.toISOString()
  const { prepared: p } = op
  const e = p.event
  const linkStatements = (eventId: string): D1PreparedStatement[] =>
    p.artists.map((a) =>
      db
        .prepare('INSERT INTO event_artists (event_id, artist_id, role, billing_order) VALUES (?, ?, ?, ?)')
        .bind(eventId, a.artistId, a.role, a.order)
    )
  const observation = (eventId: string): D1PreparedStatement =>
    db
      .prepare('INSERT INTO observations (source_id, event_id, raw_r2_key, extracted_json, extracted_at, confidence) VALUES (?, ?, ?, ?, ?, NULL)')
      .bind(sourceId, eventId, rawKey, JSON.stringify(e), at)

  if (op.kind === 'insert') {
    return [
      db
        .prepare(
          `INSERT INTO events (id, venue_id, date, open_time, start_at, start_text, title_ja, title_en, price_text, price_min_jpy,
                               status, ticket_url, first_seen_at, updated_at, fingerprint, needs_review, source_url, last_verified_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          p.id, venueId, e.date, e.open_text, p.startAt, e.start_text, e.title_ja, e.title_en ?? null, e.price_text, e.price_min_jpy,
          e.status, e.ticket_url, at, at, p.fingerprint, op.needsReview ? 1 : 0, e.source_url, at
        ),
      ...linkStatements(p.id),
      observation(p.id)
    ]
  }

  const id = op.existing.id
  if (!op.changed) {
    return [db.prepare('UPDATE events SET last_verified_at = ? WHERE id = ?').bind(at, id), observation(id)]
  }
  return [
    db
      .prepare(
        `UPDATE events SET title_ja = ?, title_en = COALESCE(?, title_en), open_time = ?, start_at = ?, start_text = ?,
                price_text = ?, price_min_jpy = ?, status = ?, ticket_url = ?, source_url = ?, fingerprint = ?,
                needs_review = ?, updated_at = ?, last_verified_at = ?
         WHERE id = ?`
      )
      .bind(
        e.title_ja, e.title_en ?? null, e.open_text, p.startAt, e.start_text, e.price_text, e.price_min_jpy, e.status,
        e.ticket_url, e.source_url, p.fingerprint, op.needsReview ? 1 : 0, at, at, id
      ),
    ...(op.artistsChanged ? [db.prepare('DELETE FROM event_artists WHERE event_id = ?').bind(id), ...linkStatements(id)] : []),
    observation(id)
  ]
}

const chunks = <T>(items: readonly T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size))

// 検証済みの公演を D1 に書く。同一判定は plan.ts。events が空なら何もしない。
export async function storeEvents(input: StoreInput): Promise<StoreSummary> {
  const empty: StoreSummary = { inserted: 0, updated: 0, unchanged: 0, flagged: 0, duplicates: 0 }
  if (input.events.length === 0) return empty
  const { db, venueId } = input

  const dates = input.events.map((a) => a.event.date).sort()
  const existing = await loadExisting(db, venueId, dates[0] as string, dates[dates.length - 1] as string)
  const resolved = await resolveArtists(
    db,
    input.events.flatMap((a) => a.event.artists.map((x) => x.name))
  )
  const prepared = await prepare(venueId, input.events, resolved.ids)
  const ops = planEvents(existing, prepared)

  const statements = [
    ...resolved.created.map((a) =>
      db.prepare('INSERT OR IGNORE INTO artists (id, name_ja, name_en) VALUES (?, ?, ?)').bind(a.id, a.name_ja, a.name_en)
    ),
    ...ops.flatMap((op) => (op.kind === 'duplicate' ? [] : statementsFor(input, op)))
  ]
  for (const group of chunks(statements, BATCH_SIZE)) await db.batch(group)

  return ops.reduce<StoreSummary>(
    (acc, op) => {
      if (op.kind === 'duplicate') return { ...acc, duplicates: acc.duplicates + 1 }
      const flagged = op.needsReview ? 1 : 0
      if (op.kind === 'insert') return { ...acc, inserted: acc.inserted + 1, flagged: acc.flagged + flagged }
      return op.changed
        ? { ...acc, updated: acc.updated + 1, flagged: acc.flagged + flagged }
        : { ...acc, unchanged: acc.unchanged + 1, flagged: acc.flagged + flagged }
    },
    empty
  )
}
