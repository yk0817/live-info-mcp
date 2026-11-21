import { describe, expect, it } from 'vitest'
import type { ExtractedEvent } from '@live-info/schema'
import { screenEvents } from './screen'

const NOW = new Date('2026-11-21T03:00:00Z') // 2026-11-21 12:00 JST
const ctx = { now: NOW, venueId: 'venue-shibuya-duo' }

const ev = (over: Partial<ExtractedEvent> = {}): ExtractedEvent => ({
  title_ja: 'T',
  date: '2026-11-25',
  open_text: null,
  start_text: '19:00',
  price_text: null,
  price_min_jpy: null,
  status: null,
  ticket_url: null,
  source_url: 'https://example.com/',
  artists: [{ name: 'A' }],
  ...over
})

describe('Contract: screenEvents は書き込む公演を選ぶ', () => {
  // Contract: 過去日は黙って捨て（月別ページに過去日が載るのは普通）、flag の理由にも数えない。今日は残す
  it('JST の今日より前は skipped_past、今日は残す', () => {
    const r = screenEvents([ev({ date: '2026-11-20' }), ev({ date: '2026-11-21' }), ev({ date: '2026-11-22' })], ctx)
    expect(r.skippedPast).toBe(1)
    expect(r.accepted.map((a) => a.event.date)).toEqual(['2026-11-21', '2026-11-22'])
    expect(r.accepted.every((a) => !a.needsReview)).toBe(true)
  })

  // Contract: 実在しない日付は書かず、数える
  it('invalid_date は捨てて skipped_invalid に数える', () => {
    const r = screenEvents([ev({ date: '2026-02-30' }), ev()], ctx)
    expect(r.skippedInvalid).toBe(1)
    expect(r.accepted).toHaveLength(1)
  })

  // Contract: invalid_date 以外の issue（出演者なし・遠すぎる未来）は残して needs_review にする
  it('empty_artists・too_far_future は needs_review で残す', () => {
    const r = screenEvents([ev({ artists: [] }), ev({ date: '2030-01-01' }), ev()], ctx)
    expect(r.accepted.map((a) => a.needsReview)).toEqual([true, true, false])
  })

  // Contract: 抽出エンジンが時刻を拒否した公演（events と同じ並びのフラグ）も needs_review
  it('抽出側のフラグが立った公演は needs_review', () => {
    const r = screenEvents([ev(), ev({ title_ja: 'U' })], ctx, [false, true])
    expect(r.accepted.map((a) => a.needsReview)).toEqual([false, true])
  })
})
