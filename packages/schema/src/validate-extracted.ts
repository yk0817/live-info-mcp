import { isRealDate } from './common'
import type { ExtractedEvent } from './extraction'
import { addYears, jstDateOf, parseShowTime } from './showtime'

export type IssueCode =
  | 'invalid_date'
  | 'past_date'
  | 'too_far_future'
  | 'venue_mismatch'
  | 'empty_artists'
  | 'invalid_start_time'

export interface Issue {
  code: IssueCode
  field: string
  message: string
}

export interface ValidationContext {
  now: Date
  venueId: string
  expectedVenueId: string
}

export type ValidationResult = { ok: true } | { ok: false; issues: Issue[] }

const MAX_YEARS_AHEAD = 2

// 設計書 手順 6 の検証。1 件でも issue が出たら needs_review にする（呼び出し側の責務）。
export function validateExtractedEvent(event: ExtractedEvent, ctx: ValidationContext): ValidationResult {
  const issues: Issue[] = []

  if (!isRealDate(event.date)) {
    issues.push({ code: 'invalid_date', field: 'date', message: 'date is not a real calendar date' })
  } else {
    // YYYY-MM-DD は辞書順がそのまま時系列順
    const today = jstDateOf(ctx.now)
    if (event.date < today) {
      issues.push({ code: 'past_date', field: 'date', message: 'date is before today (JST)' })
    } else if (event.date > addYears(today, MAX_YEARS_AHEAD)) {
      issues.push({ code: 'too_far_future', field: 'date', message: 'date is more than 2 years ahead' })
    }
  }

  if (ctx.venueId !== ctx.expectedVenueId) {
    issues.push({ code: 'venue_mismatch', field: 'venue_id', message: 'venue does not match the source' })
  }

  if (event.artists.length === 0) {
    issues.push({ code: 'empty_artists', field: 'artists', message: 'no artists extracted' })
  }

  if (event.start_text !== null) {
    const parsed = parseShowTime(event.date, event.start_text)
    // 日付不正は invalid_date で報告済みなので二重に出さない
    if (!parsed.ok && parsed.reason !== 'invalid_date') {
      issues.push({ code: 'invalid_start_time', field: 'start_text', message: `start time rejected: ${parsed.reason}` })
    }
  }

  return issues.length === 0 ? { ok: true } : { ok: false, issues }
}
