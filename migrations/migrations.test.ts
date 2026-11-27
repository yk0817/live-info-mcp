import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8')

const migrationFiles = ['0001_init.sql', '0002_indexes.sql']
const seedSql = read('../seeds/venues.sql')

const migrated = (): DatabaseSync => {
  const db = new DatabaseSync(':memory:')
  for (const f of migrationFiles) db.exec(read(f))
  return db
}

const columns = (db: DatabaseSync, table: string): string[] =>
  db.prepare(`PRAGMA table_info(${table})`).all().map((r) => String(r.name))

const indexes = (db: DatabaseSync, table: string): string[] =>
  db.prepare(`PRAGMA index_list(${table})`).all().map((r) => String(r.name))

const expectedColumns: Record<string, string[]> = {
  venues: ['id', 'name_ja', 'name_en', 'aliases', 'prefecture', 'city', 'lat', 'lng', 'capacity', 'official_url', 'timezone', 'venue_kind', 'nearest_station'],
  artists: ['id', 'name_ja', 'name_en', 'name_kana', 'aliases', 'country', 'mbid', 'official_url'],
  events: ['id', 'venue_id', 'date', 'open_time', 'start_at', 'start_text', 'title_ja', 'title_en', 'price_text', 'price_min_jpy', 'status', 'ticket_url', 'first_seen_at', 'updated_at', 'fingerprint', 'needs_review', 'source_url', 'last_verified_at'],
  event_artists: ['event_id', 'artist_id', 'role', 'billing_order'],
  sources: ['id', 'kind', 'url', 'parser', 'config_json', 'schedule_cron', 'robots_ok', 'needs_review', 'last_status', 'etag', 'last_modified', 'content_hash'],
  observations: ['id', 'source_id', 'event_id', 'raw_r2_key', 'extracted_json', 'extracted_at', 'confidence'],
  crawl_runs: ['id', 'source_id', 'started_at', 'http_status', 'bytes', 'changed', 'error']
}

const expectedIndexes: Record<string, string[]> = {
  events: ['idx_events_venue_date', 'idx_events_start_at', 'idx_events_fingerprint', 'idx_events_needs_review'],
  event_artists: ['idx_event_artists_artist'],
  artists: ['idx_artists_name_ja', 'idx_artists_name_en'],
  venues: ['idx_venues_prefecture_city'],
  sources: ['idx_sources_robots_kind'],
  observations: ['idx_observations_source', 'idx_observations_event'],
  crawl_runs: ['idx_crawl_runs_source_started']
}

const addVenue = (db: DatabaseSync, id = 'v1'): void => {
  db.prepare("INSERT INTO venues (id, name_ja, prefecture, venue_kind) VALUES (?, 'x', '東京都', 'club')").run(id)
}

const addEvent = (db: DatabaseSync, id: string, status: string | null = null, venueId = 'v1'): void => {
  db.prepare(
    "INSERT INTO events (id, venue_id, date, title_ja, status, first_seen_at, updated_at, source_url, last_verified_at) VALUES (?, ?, '2026-12-01', 't', ?, 't', 't', 'https://example.com', 't')"
  ).run(id, venueId, status)
}

describe('D1 schema', () => {
  // Contract: 全公演に題名・出典 URL・最終確認日時が付く（呼ぶ側が鮮度を判断できる）
  it('requires title_ja, source_url and last_verified_at on events', () => {
    const db = migrated()
    addVenue(db)
    const required = ['title_ja', 'source_url', 'last_verified_at']
    for (const omitted of required) {
      const cols = required.filter((c) => c !== omitted)
      const sql = `INSERT INTO events (id, venue_id, date, first_seen_at, updated_at, ${cols.join(', ')}) VALUES ('e', 'v1', '2026-12-01', 't', 't', ${cols.map(() => "'x'").join(', ')})`
      expect(() => db.exec(sql)).toThrow(new RegExp(`NOT NULL constraint failed: events\\.${omitted}`))
    }
  })

  // Contract: 設計書のデータモデルの全列と requirements.md の変更列が存在する
  it.each(Object.entries(expectedColumns))('%s has all columns', (table, cols) => {
    expect(columns(migrated(), table).sort()).toEqual([...cols].sort())
  })

  // Contract: events は start_time を持たず、date / start_at / start_text の 3 列で時刻を表す
  it('events has no legacy start_time column', () => {
    expect(columns(migrated(), 'events')).not.toContain('start_time')
  })

  // Contract: 検索・名寄せ・監視に使う索引がすべて張られている
  it.each(Object.entries(expectedIndexes))('%s has its indexes', (table, names) => {
    const actual = indexes(migrated(), table)
    for (const n of names) expect(actual).toContain(n)
  })

  // Contract: 収容人数は不明（NULL）を許し、推定値を強制しない
  it('venues.capacity is nullable', () => {
    const db = migrated()
    addVenue(db)
    expect(db.prepare('SELECT capacity FROM venues').get()?.capacity).toBeNull()
  })

  // Contract: venue_kind は livehouse / club のみ
  it('rejects unknown venue_kind', () => {
    const db = migrated()
    expect(() => db.exec("INSERT INTO venues (id, name_ja, prefecture, venue_kind) VALUES ('v', 'x', '東京都', 'x')")).toThrow(/CHECK/)
  })

  // Contract: event_artists.role は headliner / support / guest のみ
  it('rejects unknown role', () => {
    const db = migrated()
    addVenue(db)
    addEvent(db, 'e')
    db.exec("INSERT INTO artists (id, name_ja) VALUES ('a', 'x')")
    expect(() => db.exec("INSERT INTO event_artists (event_id, artist_id, role) VALUES ('e', 'a', 'x')")).toThrow(/CHECK/)
    db.exec("INSERT INTO event_artists (event_id, artist_id, role) VALUES ('e', 'a', 'headliner')")
  })

  // Contract: events.status は 4 値のみ。不明は NULL で持てる
  it('validates events.status but allows NULL', () => {
    const db = migrated()
    addVenue(db)
    const ins = (id: string, status: string | null): void => {
      addEvent(db, id, status)
    }
    ins('e1', null)
    ins('e2', 'sold_out')
    expect(() => ins('e3', 'bogus')).toThrow(/CHECK/)
  })

  // Contract: sources の kind / parser は許可値のみ、robots_ok の既定は 1、needs_review の既定は 0
  it('validates sources enums and defaults', () => {
    const db = migrated()
    expect(() => db.exec("INSERT INTO sources (id, kind, url, parser) VALUES ('s', 'x', 'u', 'rule')")).toThrow(/CHECK/)
    expect(() => db.exec("INSERT INTO sources (id, kind, url, parser) VALUES ('s', 'venue', 'u', 'x')")).toThrow(/CHECK/)
    db.exec("INSERT INTO sources (id, kind, url, parser) VALUES ('s', 'venue', 'u', 'rule')")
    const row = db.prepare('SELECT robots_ok, needs_review FROM sources').get()
    expect(row).toMatchObject({ robots_ok: 1, needs_review: 0 })
  })

  // Contract: 外部キーが効き、存在しない会場・出典を参照する行は入らない
  it('enforces foreign keys', () => {
    const db = migrated()
    expect(() => addEvent(db, 'e', null, 'nope')).toThrow(/FOREIGN KEY/)
    expect(() => db.exec("INSERT INTO crawl_runs (source_id, started_at) VALUES ('nope', 't')")).toThrow(/FOREIGN KEY/)
    expect(() => db.exec("INSERT INTO observations (source_id, extracted_at) VALUES ('nope', 't')")).toThrow(/FOREIGN KEY/)
  })
})

describe('seeds/venues.sql', () => {
  // Contract: シードは冪等で、Phase 0（ライブハウス 3・クラブ 2）と batch 1（ライブハウス 6・クラブ 4）の計 15 件。
  // 人が埋める項目は推定しない。capacity は公式サイトに明記された La.mama（230）だけ
  it('is idempotent and holds 9 livehouse + 6 club with unknowns left NULL', () => {
    const db = migrated()
    db.exec(seedSql)
    db.exec(seedSql)
    expect(db.prepare('SELECT COUNT(*) AS n FROM venues').get()?.n).toBe(15)
    const kinds = db.prepare('SELECT venue_kind, COUNT(*) AS n FROM venues GROUP BY venue_kind ORDER BY venue_kind').all()
    expect(kinds.map((r) => ({ ...r }))).toEqual([
      { venue_kind: 'club', n: 6 },
      { venue_kind: 'livehouse', n: 9 }
    ])
    const located = db.prepare('SELECT COUNT(*) AS n FROM venues WHERE lat IS NOT NULL OR lng IS NOT NULL OR official_url IS NOT NULL').get()
    expect(located?.n).toBe(0)
    const withCapacity = db.prepare('SELECT id, capacity FROM venues WHERE capacity IS NOT NULL').all()
    expect(withCapacity.map((r) => ({ ...r }))).toEqual([{ id: 'venue-shibuya-lamama', capacity: 230 }])
  })

  // Contract: マイグレーションにはデータを入れない
  it('migrations insert no rows', () => {
    const db = migrated()
    expect(db.prepare('SELECT COUNT(*) AS n FROM venues').get()?.n).toBe(0)
  })
})
