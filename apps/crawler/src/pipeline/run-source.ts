import { jstDateOf } from '@live-info/schema'
import { detectChange, saveRawHtml, type RawBucket } from '../change'
import { extractEvents, fillUrlTemplate, venueExtractConfigSchema, type ExtractionResult, type VenueExtractConfig } from '../extract'
import { backoffSec, conditionalFetch, type FetchDeps } from '../fetch'
import { storeEvents, type StoreSummary } from '../store'
import { screenEvents } from './screen'

export const MAX_ATTEMPTS = 5

// 直前の件数からこの割合を下回ったら、レイアウト変更などの異常として何も書かない
const COUNT_DROP_RATIO = 0.5

export interface RunDeps {
  db: D1Database
  bucket: RawBucket
  fetch: FetchDeps
  now: () => Date
}

export interface RunSummary extends StoreSummary {
  extracted: number
  skipped_past: number
  skipped_invalid: number
}

export type RunStatus =
  | 'unknown_source'
  | 'no_config'
  | 'invalid_config'
  | 'blocked'
  | 'error'
  | 'not_modified'
  | 'unchanged'
  | 'stored'
  | 'count_drop'
  | 'no_events'

export type RunResult =
  | { kind: 'retry'; afterSec: number; reason: string }
  | { kind: 'done'; status: RunStatus; error: string | null; summary?: RunSummary }

interface SourceRow {
  id: string
  url: string
  config_json: string | null
  etag: string | null
  last_modified: string | null
  content_hash: string | null
}

interface RunRecord {
  httpStatus: number | null
  bytes: number | null
  changed: 0 | 1 | null
  error: string | null
}

const done = (status: RunStatus, error: string | null = null, summary?: RunSummary): RunResult => ({
  kind: 'done',
  status,
  error,
  ...(summary ? { summary } : {})
})

// source id は `src_<venue_id>`
const venueIdOf = (sourceId: string): string => sourceId.replace(/^src_/, '')

const insertRun = (db: D1Database, sourceId: string, startedAt: string, r: RunRecord): D1PreparedStatement =>
  db
    .prepare('INSERT INTO crawl_runs (source_id, started_at, http_status, bytes, changed, error) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(sourceId, startedAt, r.httpStatus, r.bytes, r.changed, r.error)

// 変化が無かった回は、これまでに観測した今日以降の公演の「最終確認」だけ進める
const bumpVerified = (db: D1Database, sourceId: string, today: string, at: string): D1PreparedStatement =>
  db
    .prepare(
      'UPDATE events SET last_verified_at = ? WHERE date >= ? AND id IN (SELECT event_id FROM observations WHERE source_id = ? AND event_id IS NOT NULL)'
    )
    .bind(at, today, sourceId)

function parseConfig(json: string): VenueExtractConfig | null {
  try {
    const parsed = venueExtractConfigSchema.safeParse(JSON.parse(json))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

// 抽出エンジンの issue（DOM 上の item 番号）を、events（スキップを除いた並び）の番号に直す
function extractionFlags(extraction: ExtractionResult): boolean[] {
  const skipped = new Set(extraction.skipped.map((s) => s.index))
  const flagged = new Set(extraction.issues.map((i) => i.index))
  return Array.from({ length: extraction.itemCount }, (_, i) => i)
    .filter((i) => !skipped.has(i))
    .map((i) => flagged.has(i))
}

// ページの件数が前回より大きく減ったら異常として扱う（T12 の安全網の簡易版）。
// 比べる相手は「この source が観測した公演のうち、今回のページの最初の日以降」。過去日を捨てても分母が痩せない。
async function guardCount(db: D1Database, sourceId: string, extracted: ExtractionResult, today: string): Promise<'count_drop' | 'no_events' | null> {
  const dates = extracted.events.map((e) => e.date).sort()
  const from = dates[0] ?? today
  const row = await db
    .prepare(
      `SELECT COUNT(DISTINCT e.id) AS n FROM observations o JOIN events e ON e.id = o.event_id
       WHERE o.source_id = ? AND e.date >= ?`
    )
    .bind(sourceId, from)
    .first<{ n: number }>()
  const previous = row?.n ?? 0
  if (extracted.events.length === 0) return previous > 0 ? 'count_drop' : 'no_events'
  return previous > 0 && extracted.events.length < previous * COUNT_DROP_RATIO ? 'count_drop' : null
}

async function run(deps: RunDeps, sourceId: string, attempt: number, startedAt: Date): Promise<RunResult> {
  const { db } = deps
  const at = startedAt.toISOString()
  const today = jstDateOf(startedAt)
  const recordOnly = async (r: RunRecord): Promise<void> => {
    await insertRun(db, sourceId, at, r).run()
  }

  const row = await db
    .prepare('SELECT id, url, config_json, etag, last_modified, content_hash FROM sources WHERE id = ?')
    .bind(sourceId)
    .first<SourceRow>()
  if (!row) return done('unknown_source', 'unknown_source')

  if (row.config_json === null) {
    await recordOnly({ httpStatus: null, bytes: null, changed: null, error: 'no_config' })
    return done('no_config', 'no_config')
  }
  const config = parseConfig(row.config_json)
  if (config === null) {
    await recordOnly({ httpStatus: null, bytes: null, changed: null, error: 'invalid_config' })
    return done('invalid_config', 'invalid_config')
  }

  const url = config.url_template ? fillUrlTemplate(config.url_template, startedAt) : row.url
  const venueId = venueIdOf(sourceId)
  const fetched = await conditionalFetch(deps.fetch, { url, etag: row.etag, lastModified: row.last_modified, attempt })

  switch (fetched.kind) {
    case 'not_modified':
      await db.batch([
        bumpVerified(db, sourceId, today, at),
        db.prepare('UPDATE sources SET last_status = 304 WHERE id = ?').bind(sourceId),
        insertRun(db, sourceId, at, { httpStatus: 304, bytes: null, changed: 0, error: null })
      ])
      return done('not_modified')

    case 'blocked': {
      const error = `robots:${fetched.detail}`
      await db.batch([
        // 禁止と分かったら以後の対象から外す。取得失敗（robots_unavailable）は次回また試す
        ...(fetched.detail === 'disallowed' ? [db.prepare('UPDATE sources SET robots_ok = 0 WHERE id = ?').bind(sourceId)] : []),
        insertRun(db, sourceId, at, { httpStatus: null, bytes: null, changed: null, error })
      ])
      return done('blocked', error)
    }

    case 'retry': {
      const exhausted = attempt >= MAX_ATTEMPTS
      const error = `${exhausted ? 'retry_exhausted' : 'retry'}:${fetched.reason}`
      await recordOnly({ httpStatus: null, bytes: null, changed: null, error })
      return exhausted ? done('error', error) : { kind: 'retry', afterSec: fetched.afterSec, reason: fetched.reason }
    }

    case 'error':
      await db.batch([
        ...(fetched.httpStatus !== undefined ? [db.prepare('UPDATE sources SET last_status = ? WHERE id = ?').bind(fetched.httpStatus, sourceId)] : []),
        insertRun(db, sourceId, at, { httpStatus: fetched.httpStatus ?? null, bytes: null, changed: null, error: fetched.error })
      ])
      return done('error', fetched.error)

    case 'ok':
      break
  }

  const detected = await detectChange({ previousHash: row.content_hash, html: fetched.body })
  const base = { httpStatus: fetched.httpStatus, bytes: fetched.bytes }
  const updateSource = (hash: string | null): D1PreparedStatement =>
    db
      .prepare('UPDATE sources SET etag = ?, last_modified = ?, content_hash = COALESCE(?, content_hash), last_status = ? WHERE id = ?')
      .bind(fetched.etag, fetched.lastModified, hash, fetched.httpStatus, sourceId)

  if (!detected.changed) {
    await db.batch([bumpVerified(db, sourceId, today, at), updateSource(null), insertRun(db, sourceId, at, { ...base, changed: 0, error: null })])
    return done('unchanged')
  }

  const rawKey = await saveRawHtml(deps.bucket, { sourceId, fetchedAt: startedAt, hash: detected.hash, html: fetched.body })
  const extraction = extractEvents(fetched.body, config, { now: startedAt, sourceUrl: url, venueId })

  // 異常のときは etag・content_hash を更新しない。更新すると次回が 304 や「変化なし」になり、異常が埋もれる
  const guard = await guardCount(db, sourceId, extraction, today)
  if (guard !== null) {
    await db.batch([
      db.prepare('UPDATE sources SET last_status = ? WHERE id = ?').bind(fetched.httpStatus, sourceId),
      insertRun(db, sourceId, at, { ...base, changed: 1, error: guard })
    ])
    return done(guard, guard)
  }

  const screened = screenEvents(extraction.events, { now: startedAt, venueId }, extractionFlags(extraction))
  const stored = await storeEvents({ db, venueId, sourceId, rawKey, now: startedAt, events: screened.accepted })
  await db.batch([updateSource(detected.hash), insertRun(db, sourceId, at, { ...base, changed: 1, error: null })])
  return done('stored', null, {
    ...stored,
    extracted: extraction.events.length,
    skipped_past: screened.skippedPast,
    skipped_invalid: screened.skippedInvalid
  })
}

// 1 つの source を取得 → 変化検知 → 抽出 → D1 まで回す。呼び出し側（Queue）は retry なら delay をつけて再投入する。
export async function runSource(deps: RunDeps, sourceId: string, attempt = 0): Promise<RunResult> {
  const startedAt = deps.now()
  try {
    return await run(deps, sourceId, attempt, startedAt)
  } catch (e) {
    // D1・R2 の一時的な失敗など。記録を試みて、回数内なら再試行に回す
    const message = e instanceof Error ? e.message : String(e)
    const exhausted = attempt >= MAX_ATTEMPTS
    const error = `${exhausted ? 'retry_exhausted' : 'retry'}:exception:${message}`.slice(0, 300)
    try {
      await insertRun(deps.db, sourceId, startedAt.toISOString(), { httpStatus: null, bytes: null, changed: null, error }).run()
    } catch {
      // 記録も失敗したら諦める。次回の実行に任せる
    }
    return exhausted ? done('error', error) : { kind: 'retry', afterSec: backoffSec(attempt), reason: 'exception' }
  }
}
