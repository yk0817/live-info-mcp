import { isRealDate } from './common'

const JST_OFFSET_MIN = 9 * 60
const MAX_MINUTES = 29 * 60 // 28:59 まで許す

export type ShowTimeFailure = 'invalid_date' | 'malformed' | 'minutes_out_of_range' | 'hours_out_of_range'

export type ParsedShowTime =
  | { ok: true; start_at: string; start_text: string }
  | { ok: false; reason: ShowTimeFailure }

function dayStartUtcMs(date: string): number {
  const [y, mo, d] = date.split('-').map(Number) as [number, number, number]
  return Date.UTC(y, mo - 1, d, 0, -JST_OFFSET_MIN)
}

// 興行日の 0:00 JST を起点に、`H:MM`（0:00〜28:59）を UTC の ISO 日時へ変換する。
export function parseShowTime(date: string, text: string): ParsedShowTime {
  if (!isRealDate(date)) return { ok: false, reason: 'invalid_date' }
  // 全角数字・コロンも拾う
  const normalized = text.normalize('NFKC').trim()
  const m = /^(\d{1,2}):(\d{2})$/.exec(normalized)
  if (!m) return { ok: false, reason: 'malformed' }
  const hours = Number(m[1])
  const minutes = Number(m[2])
  if (minutes >= 60) return { ok: false, reason: 'minutes_out_of_range' }
  const total = hours * 60 + minutes
  if (total >= MAX_MINUTES) return { ok: false, reason: 'hours_out_of_range' }
  return { ok: true, start_at: new Date(dayStartUtcMs(date) + total * 60000).toISOString(), start_text: normalized }
}

// start_at を興行日基準の表記（24:30 など）に戻す。興行日から 0:00〜28:59 の範囲外なら null。
export function formatShowTime(startAt: string, date: string): string | null {
  if (!isRealDate(date)) return null
  const startMs = Date.parse(startAt)
  if (Number.isNaN(startMs)) return null
  const offsetMin = (startMs - dayStartUtcMs(date)) / 60000
  if (!Number.isInteger(offsetMin) || offsetMin < 0 || offsetMin >= MAX_MINUTES) return null
  const hh = String(Math.floor(offsetMin / 60)).padStart(2, '0')
  const mm = String(offsetMin % 60).padStart(2, '0')
  return `${hh}:${mm}`
}

// now（UTC の瞬間）が属する JST の暦日を YYYY-MM-DD で返す。
export function jstDateOf(now: Date): string {
  return new Date(now.getTime() + JST_OFFSET_MIN * 60000).toISOString().slice(0, 10)
}

// 暦日に年数を足す。うるう日は月末に丸める（2028-02-29 + 2 年 → 2030-02-28）。
export function addYears(date: string, years: number): string {
  const [y, mo, d] = date.split('-').map(Number) as [number, number, number]
  const target = y + years
  const lastDay = new Date(Date.UTC(target, mo, 0)).getUTCDate()
  const day = Math.min(d, lastDay)
  return `${String(target).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}
