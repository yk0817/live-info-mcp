import { describe, expect, it } from 'vitest'
import { addYears, formatShowTime, jstDateOf, parseShowTime } from './index'

describe('parseShowTime', () => {
  // Contract: 24:30 on the show date means 00:30 JST the next day = 15:30Z on the show date.
  it('converts 24:30 to the next day 00:30 JST in UTC', () => {
    const r = parseShowTime('2026-11-21', '24:30')
    expect(r).toEqual({ ok: true, start_at: '2026-11-21T15:30:00.000Z', start_text: '24:30' })
  })

  // Contract: ordinary evening times are plain JST -> UTC (-9h).
  it('converts 18:30 to 09:30Z same day', () => {
    const r = parseShowTime('2026-11-21', '18:30')
    expect(r.ok && r.start_at).toBe('2026-11-21T09:30:00.000Z')
  })

  // Contract: 0:00 is midnight at the start of the show date, i.e. previous day 15:00Z.
  it('accepts 0:00 and single-digit hours', () => {
    const r = parseShowTime('2026-11-21', '0:00')
    expect(r.ok && r.start_at).toBe('2026-11-20T15:00:00.000Z')
    expect(parseShowTime('2026-11-21', '9:05').ok).toBe(true)
  })

  // Contract: the accepted range ends at 28:59 and 29:00 is rejected.
  it('accepts 28:59 and rejects 29:00', () => {
    const ok = parseShowTime('2026-11-21', '28:59')
    expect(ok.ok && ok.start_at).toBe('2026-11-21T19:59:00.000Z')
    expect(parseShowTime('2026-11-21', '29:00')).toEqual({ ok: false, reason: 'hours_out_of_range' })
    expect(parseShowTime('2026-11-21', '30:15').ok).toBe(false)
  })

  // Contract: malformed input never produces a time.
  it.each(['', 'abc', '24', '24:5', '1:2:3', '-1:00'])('rejects malformed %j', (text) => {
    expect(parseShowTime('2026-11-21', text)).toEqual({ ok: false, reason: 'malformed' })
  })

  // Contract: minutes >= 60 are rejected even when the hour is also out of range.
  it('rejects 25:61 and 12:60 on minutes', () => {
    expect(parseShowTime('2026-11-21', '25:61')).toEqual({ ok: false, reason: 'minutes_out_of_range' })
    expect(parseShowTime('2026-11-21', '12:60').ok).toBe(false)
  })

  // Contract: an impossible show date is reported, not silently rolled over.
  it('rejects a non-existent date', () => {
    expect(parseShowTime('2026-02-30', '19:00')).toEqual({ ok: false, reason: 'invalid_date' })
  })

  // Contract: year boundaries roll over by real calendar math.
  it('handles year-end rollover', () => {
    const r = parseShowTime('2026-12-31', '25:00')
    expect(r.ok && r.start_at).toBe('2026-12-31T16:00:00.000Z')
  })
})

describe('formatShowTime', () => {
  // Contract: output uses the 24h+ display convention anchored to the show date.
  it('renders next-day 00:30 JST as 24:30', () => {
    expect(formatShowTime('2026-11-21T15:30:00.000Z', '2026-11-21')).toBe('24:30')
  })

  // Contract: instants outside the show-date window cannot be displayed.
  it('returns null outside 0:00-28:59 of the show date', () => {
    expect(formatShowTime('2026-11-20T14:59:00.000Z', '2026-11-21')).toBeNull()
    expect(formatShowTime('2026-11-21T20:00:00.000Z', '2026-11-21')).toBeNull()
    expect(formatShowTime('garbage', '2026-11-21')).toBeNull()
  })

  // Contract: format(parse(x)) is the zero-padded x for every valid minute of the window.
  it('round-trips every minute from 0:00 to 28:59', () => {
    for (let total = 0; total < 29 * 60; total++) {
      const text = `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
      const parsed = parseShowTime('2026-03-31', text)
      if (!parsed.ok) throw new Error(`parse failed for ${text}`)
      expect(formatShowTime(parsed.start_at, '2026-03-31')).toBe(text.padStart(5, '0'))
    }
  })
})

describe('date helpers', () => {
  // Contract: JST day flips at 15:00Z.
  it('jstDateOf uses UTC+9', () => {
    expect(jstDateOf(new Date('2026-11-20T14:59:59.999Z'))).toBe('2026-11-20')
    expect(jstDateOf(new Date('2026-11-20T15:00:00.000Z'))).toBe('2026-11-21')
  })

  // Contract: leap day clamps to month end.
  it('addYears clamps Feb 29', () => {
    expect(addYears('2028-02-29', 2)).toBe('2030-02-28')
    expect(addYears('2026-11-21', 2)).toBe('2028-11-21')
  })
})
