import { isoDateSchema, jstDateOf } from '@live-info/schema'

export const DEFAULT_RANGE_DAYS = 30

export type Clock = () => Date

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

export type DateRange = { ok: true; from: string; to: string } | { ok: false; error: string }

// 既定は「今日（JST）から 30 日」。片側だけ指定されたら、もう片側は指定日基準で補う。
export function resolveRange(input: { date_from?: string | undefined; date_to?: string | undefined }, clock: Clock): DateRange {
  for (const [name, v] of [['date_from', input.date_from], ['date_to', input.date_to]] as const) {
    if (v !== undefined && !isoDateSchema.safeParse(v).success) {
      return { ok: false, error: `${name} must be a real calendar date in YYYY-MM-DD form` }
    }
  }
  const today = jstDateOf(clock())
  const from = input.date_from ?? today
  const to = input.date_to ?? addDays(from, DEFAULT_RANGE_DAYS)
  if (from > to) return { ok: false, error: 'date_from must not be after date_to' }
  return { ok: true, from, to }
}
