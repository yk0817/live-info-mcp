import { describe, expect, it } from 'vitest'
import { extractedEventSchema, validateExtractedEvent, type ExtractedEvent, type Issue } from './index'

// 2026-11-21 12:00 JST
const NOW = new Date('2026-11-21T03:00:00.000Z')
const ctx = { now: NOW, venueId: 'v1', expectedVenueId: 'v1' }

function base(over: Partial<ExtractedEvent> = {}): ExtractedEvent {
  return {
    title_ja: 'テスト公演',
    date: '2026-12-01',
    open_text: '18:00',
    start_text: '19:00',
    price_text: null,
    price_min_jpy: null,
    status: null,
    ticket_url: null,
    source_url: 'https://example.com/schedule',
    artists: [{ name: 'Band A' }],
    ...over
  }
}

function codes(r: ReturnType<typeof validateExtractedEvent>): Issue['code'][] {
  return r.ok ? [] : r.issues.map((i) => i.code)
}

describe('validateExtractedEvent', () => {
  // Contract: a clean event passes with no issues.
  it('accepts a valid event', () => {
    expect(validateExtractedEvent(base(), ctx)).toEqual({ ok: true })
  })

  // Contract: today's date (JST) is not "past".
  it('treats today as valid and yesterday as past', () => {
    expect(validateExtractedEvent(base({ date: '2026-11-21' }), ctx).ok).toBe(true)
    expect(codes(validateExtractedEvent(base({ date: '2026-11-20' }), ctx))).toEqual(['past_date'])
  })

  // Contract: "today" is judged in JST, not UTC (20th 16:00Z is already the 21st in JST).
  it('uses the JST calendar day', () => {
    const lateUtc = { ...ctx, now: new Date('2026-11-20T16:00:00.000Z') }
    expect(validateExtractedEvent(base({ date: '2026-11-21' }), lateUtc).ok).toBe(true)
    expect(codes(validateExtractedEvent(base({ date: '2026-11-20' }), lateUtc))).toEqual(['past_date'])
  })

  // Contract: exactly 2 years ahead is allowed; one day later is too far.
  it('allows exactly 2 years ahead and rejects the next day', () => {
    expect(validateExtractedEvent(base({ date: '2028-11-21' }), ctx).ok).toBe(true)
    expect(codes(validateExtractedEvent(base({ date: '2028-11-22' }), ctx))).toEqual(['too_far_future'])
  })

  // Contract: a Feb 29 anchor clamps to month end instead of overflowing into March.
  it('clamps the 2-year limit when today is Feb 29', () => {
    const leap = { ...ctx, now: new Date('2028-02-29T03:00:00.000Z') }
    expect(validateExtractedEvent(base({ date: '2030-02-28' }), leap).ok).toBe(true)
    expect(codes(validateExtractedEvent(base({ date: '2030-03-01' }), leap))).toEqual(['too_far_future'])
  })

  // Contract: a venue differing from the source's expected venue is flagged.
  it('flags venue mismatch', () => {
    expect(codes(validateExtractedEvent(base(), { ...ctx, venueId: 'v2' }))).toEqual(['venue_mismatch'])
  })

  // Contract: an event without artists is flagged.
  it('flags empty artists', () => {
    expect(codes(validateExtractedEvent(base({ artists: [] }), ctx))).toEqual(['empty_artists'])
  })

  // Contract: 28:59 is accepted, 29:00 and malformed times are flagged, null start is fine.
  it('validates the start time window', () => {
    expect(validateExtractedEvent(base({ start_text: '28:59' }), ctx).ok).toBe(true)
    expect(codes(validateExtractedEvent(base({ start_text: '29:00' }), ctx))).toEqual(['invalid_start_time'])
    expect(codes(validateExtractedEvent(base({ start_text: '25:61' }), ctx))).toEqual(['invalid_start_time'])
    expect(codes(validateExtractedEvent(base({ start_text: 'abc' }), ctx))).toEqual(['invalid_start_time'])
    expect(codes(validateExtractedEvent(base({ start_text: '' }), ctx))).toEqual(['invalid_start_time'])
    expect(validateExtractedEvent(base({ start_text: null }), ctx).ok).toBe(true)
  })

  // Contract: all problems are reported together, and the input is not mutated.
  it('collects multiple issues without mutating input', () => {
    const ev = base({ date: '2020-01-01', artists: [], start_text: '30:00' })
    const snapshot = JSON.parse(JSON.stringify(ev)) as ExtractedEvent
    const r = validateExtractedEvent(ev, { ...ctx, venueId: 'x' })
    expect(codes(r).sort()).toEqual(['empty_artists', 'invalid_start_time', 'past_date', 'venue_mismatch'])
    expect(ev).toEqual(snapshot)
  })
})

describe('extractedEventSchema', () => {
  // Contract: LLM output is accepted only when shape and calendar date are valid.
  it('parses a valid event and rejects bad dates and statuses', () => {
    expect(extractedEventSchema.safeParse(base()).success).toBe(true)
    expect(extractedEventSchema.safeParse(base({ date: '2026-02-30' })).success).toBe(false)
    expect(extractedEventSchema.safeParse(base({ date: '2026/12/01' })).success).toBe(false)
    expect(extractedEventSchema.safeParse({ ...base(), status: 'unknown' }).success).toBe(false)
  })
})
