import { describe, expect, it } from 'vitest'
import * as pkg from '@live-info/schema'
import type { Artist, Event, EventArtist, ExtractedEvent, Source, Venue } from '@live-info/schema'

describe('package entry', () => {
  // Contract: crawler and MCP consume domain + extraction types through the package entry only.
  it('exposes domain and extraction schemas with consumable types', () => {
    const venue: Venue = pkg.venueSchema.parse({
      id: 'v1',
      name_ja: '会場',
      name_en: null,
      aliases: [],
      prefecture: '東京都',
      city: '渋谷区',
      lat: null,
      lng: null,
      capacity: null,
      venue_kind: 'club',
      nearest_station: null,
      official_url: null,
      timezone: 'Asia/Tokyo'
    })
    expect(venue.capacity).toBeNull()

    const extracted: ExtractedEvent = pkg.extractedEventSchema.parse({
      title_ja: 't',
      date: '2026-12-01',
      open_text: null,
      start_text: '24:30',
      price_text: null,
      price_min_jpy: null,
      status: 'on_sale',
      ticket_url: null,
      source_url: 'https://example.com/',
      artists: [{ name: 'A', role: 'headliner' }]
    })
    expect(extracted.artists[0]?.role).toBe('headliner')

    // Type-level only: the remaining domain types are importable from the entry.
    const unused: [Artist?, Event?, EventArtist?, Source?] = []
    expect(unused).toHaveLength(0)
    expect(pkg.venueIdSchema.safeParse('').success).toBe(false)
  })
})
