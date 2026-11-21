import { describe, expect, it } from 'vitest'
import { artistSchema, eventArtistSchema, sourceSchema, venueSchema } from '@live-info/schema'

// Contract: ここの許容は D1（migrations/0001_init.sql）の NULL 可否と一致させる。
// 片方だけ変えると、読み出した行が検証で落ちる。
describe('domain schemas match the D1 columns', () => {
  it('sources carry config_json and needs_review', () => {
    const base = {
      id: 's1',
      kind: 'venue',
      url: 'https://example.com/schedule',
      parser: 'rule',
      config_json: null,
      schedule_cron: null,
      robots_ok: true,
      needs_review: false,
      last_status: null,
      etag: null,
      last_modified: null,
      content_hash: null
    }
    expect(sourceSchema.safeParse(base).success).toBe(true)
    expect(sourceSchema.safeParse({ ...base, config_json: '{"selector":".event"}' }).success).toBe(true)
    const withoutFlag: Record<string, unknown> = { ...base }
    delete withoutFlag['needs_review']
    expect(sourceSchema.safeParse(withoutFlag).success).toBe(false)
  })

  it('allows the nullable columns that D1 allows', () => {
    expect(eventArtistSchema.safeParse({ event_id: 'e', artist_id: 'a', role: 'headliner', billing_order: null }).success).toBe(true)
    expect(artistSchema.safeParse({ id: 'a', name_ja: null, name_en: 'DJ X', name_kana: null, aliases: [], country: null, mbid: null, official_url: null }).success).toBe(true)
    const venue = {
      id: 'v',
      name_ja: '会場',
      name_en: null,
      aliases: [],
      prefecture: '東京都',
      city: null,
      lat: null,
      lng: null,
      capacity: null,
      venue_kind: 'club',
      nearest_station: null,
      official_url: null,
      timezone: 'Asia/Tokyo'
    }
    expect(venueSchema.safeParse(venue).success).toBe(true)
  })
})
