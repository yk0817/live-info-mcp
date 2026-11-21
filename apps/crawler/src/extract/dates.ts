import { isRealDate, jstDateOf } from '@live-info/schema'

const pad2 = (n: number): string => String(n).padStart(2, '0')

export const toIsoDate = (year: number, month: number, day: number): string =>
  `${String(year).padStart(4, '0')}-${pad2(month)}-${pad2(day)}`

export interface YearMonth {
  year: number
  month: number
}

const dayNumber = (year: number, month: number, day: number): number => Date.UTC(year, month - 1, day) / 86_400_000

// 年のない月日から年を決める。
//   prev が無い（先頭）: now（JST）の年の前後 1 年から、今日に最も近くなる年（実在する日付のみ）
//   prev がある: 直前の公演と同じ年。月が 6 か月超戻ったら年越しとみなして翌年
export function inferYear(month: number, day: number, prev: YearMonth | null, now: Date): number {
  if (prev) return month < prev.month - 6 ? prev.year + 1 : prev.year
  const today = jstDateOf(now)
  const [ty, tm, td] = today.split('-').map(Number) as [number, number, number]
  const todayN = dayNumber(ty, tm, td)
  const candidates = [ty - 1, ty, ty + 1].filter((y) => isRealDate(toIsoDate(y, month, day)))
  const best = candidates.reduce<number | null>(
    (acc, y) => (acc === null || Math.abs(dayNumber(y, month, day) - todayN) < Math.abs(dayNumber(acc, month, day) - todayN) ? y : acc),
    null
  )
  return best ?? ty
}

// YYYY / MM の置換。now の JST の年月。
export function fillUrlTemplate(template: string, now: Date): string {
  const [year, month] = jstDateOf(now).split('-') as [string, string, string]
  return template.replaceAll('{YYYY}', year).replaceAll('{MM}', month).replaceAll('{M}', String(Number(month)))
}
