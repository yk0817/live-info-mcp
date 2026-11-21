import { jstDateOf, validateExtractedEvent, type ExtractedEvent } from '@live-info/schema'
import type { AcceptedEvent } from '../store'

export interface ScreenResult {
  accepted: AcceptedEvent[]
  skippedPast: number
  skippedInvalid: number
}

// 書き込む公演を選ぶ。月別ページは過去日を含むのが普通なので、過去日は黙って捨てる（past_date の issue にしない）。
// 実在しない日付は捨て、それ以外の issue は needs_review にして残す。
// extractionFlags は抽出エンジン側の issue（29:00 以上の時刻など）があった公演（events と同じ並び）。
export function screenEvents(
  events: readonly ExtractedEvent[],
  ctx: { now: Date; venueId: string },
  extractionFlags: readonly boolean[] = []
): ScreenResult {
  const today = jstDateOf(ctx.now)
  const accepted: AcceptedEvent[] = []
  let skippedPast = 0
  let skippedInvalid = 0
  events.forEach((event, i) => {
    const result = validateExtractedEvent(event, { now: ctx.now, venueId: ctx.venueId, expectedVenueId: ctx.venueId })
    const issues = result.ok ? [] : result.issues
    if (issues.some((x) => x.code === 'invalid_date')) {
      skippedInvalid += 1
      return
    }
    if (event.date < today) {
      skippedPast += 1
      return
    }
    accepted.push({ event, needsReview: issues.length > 0 || extractionFlags[i] === true })
  })
  return { accepted, skippedPast, skippedInvalid }
}
