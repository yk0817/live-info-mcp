import { readdirSync, readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { venueExtractConfigSchema } from './config'

const repo = (path: string): string => resolve(import.meta.dirname, '../../../..', path)
const read = (path: string): string => readFileSync(repo(path), 'utf8')

const configDir = repo('apps/crawler/venue-configs')
const configFiles = readdirSync(configDir).filter((f) => f.endsWith('.json'))

function seeded(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  for (const f of ['migrations/0001_init.sql', 'migrations/0002_indexes.sql', 'seeds/venues.sql', 'seeds/sources.sql']) db.exec(read(f))
  return db
}

describe('Contract: venue-configs/*.json は抽出設定のスキーマに通る', () => {
  it('Phase 0 の 5 会場と batch 1 の 10 会場ぶんの設定がある', () => {
    expect(configFiles.map((f) => f.replace(/\.json$/, '')).sort()).toEqual([
      'venue-daikanyama-spaceodd',
      'venue-daikanyama-unit',
      'venue-ebisu-batica',
      'venue-nakameguro-solfa',
      'venue-shibuya-circus',
      'venue-shibuya-duo',
      'venue-shibuya-lamama',
      'venue-shibuya-o-crest',
      'venue-shibuya-o-nest',
      'venue-shibuya-o-west',
      'venue-shibuya-quattro',
      'venue-shibuya-theroom',
      'venue-shibuya-womb',
      'venue-shimokitazawa-shelter',
      'venue-shinjuku-loft'
    ])
  })

  it.each(configFiles)('%s', (file) => {
    expect(venueExtractConfigSchema.safeParse(JSON.parse(readFileSync(resolve(configDir, file), 'utf8'))).success).toBe(true)
  })
})

describe('Contract: seeds/source-configs.sql は migrations と seeds の上にそのまま適用でき、設定を欠落なく入れる', () => {
  it('config_json が設定ファイルと一致し（生成物の古さを検知）、needs_review が 0 になる', () => {
    const db = seeded()
    db.exec(read('seeds/source-configs.sql'))
    for (const file of configFiles) {
      const venueId = file.replace(/\.json$/, '')
      const row = db.prepare('SELECT config_json, needs_review FROM sources WHERE id = ?').get(`src_${venueId}`)
      expect(row, venueId).toBeDefined()
      const parsed: unknown = JSON.parse(String(row?.config_json))
      expect(venueExtractConfigSchema.safeParse(parsed).success).toBe(true)
      expect(parsed).toEqual(JSON.parse(readFileSync(resolve(configDir, file), 'utf8')))
      expect(row?.needs_review).toBe(0)
    }
  })

  it('何度流しても同じ結果で、取得元の行数は増えない', () => {
    const db = seeded()
    db.exec(read('seeds/source-configs.sql'))
    const snapshot = db.prepare('SELECT id, config_json, needs_review FROM sources ORDER BY id').all().map((r) => ({ ...r }))
    db.exec(read('seeds/source-configs.sql'))
    expect(db.prepare('SELECT id, config_json, needs_review FROM sources ORDER BY id').all().map((r) => ({ ...r }))).toEqual(snapshot)
    expect(snapshot).toHaveLength(15)
  })
})
