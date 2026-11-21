import { z } from 'zod'

export function isRealDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const t = new Date(Date.UTC(y, mo - 1, d))
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d
}

// 興行日（JST の暦日）。形式だけでなく実在する日付かまで見る。
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isRealDate, { message: 'not a real calendar date' })

// UTC の ISO 日時（`...Z`）。D1 には文字列で持つ。
export const utcDatetimeSchema = z.iso.datetime()
