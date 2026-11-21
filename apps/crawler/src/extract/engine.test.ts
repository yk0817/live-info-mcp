import { describe, expect, it } from 'vitest'
import { venueExtractConfigSchema, type VenueExtractConfig } from './config'
import { fillUrlTemplate } from './dates'
import { extractEvents } from './engine'
import { normalizeUrl } from './values'

const ctx = (now: string) => ({ now: new Date(now), sourceUrl: 'https://example.com/schedule/', venueId: 'v1' })

// 最小の設定。テストごとに fields の一部だけ差し替える。
const config = (fields: Partial<VenueExtractConfig['fields']> = {}, rest: Partial<VenueExtractConfig> = {}): VenueExtractConfig =>
  venueExtractConfigSchema.parse({
    version: 1,
    strategy: 'dom',
    item: '.ev',
    fields: {
      date: { source: { selector: '.d' }, pattern: '(?<month>\\d{1,2})/(?<day>\\d{1,2})' },
      title: { sources: [{ selector: '.t' }], mode: 'first' },
      ...fields
    },
    ...rest
  })

const html = (items: string[]): string => `<body>${items.map((i) => `<div class="ev">${i}</div>`).join('')}</body>`
const item = (d: string, t = 'ライブ', extra = ''): string => `<span class="d">${d}</span><span class="t">${t}</span>${extra}`

describe('Contract: ラベル引き（dt の次の dd）', () => {
  const cfg = config({
    times: {
      source: { label: { selector: 'dt', pattern: '^OPEN/START$' } },
      patterns: ['(?<open>\\d{1,2}:\\d{2})\\s*/\\s*(?<start>\\d{1,2}:\\d{2})', '^(?<start>\\d{1,2}:\\d{2})$']
    }
  })
  const row = (label: string, value: string): string => `<dl><dt>${label}</dt><dd>${value}</dd></dl>`

  it('ラベルの位置が変わっても同じ値を引く', () => {
    const page = html([
      item('12/01', 'A', row('ADV.', '3000') + row('OPEN/START', '18:00 / 19:00')),
      item('12/02', 'B', row('OPEN/START', '24:00') + row('ADV.', '3000'))
    ])
    const r = extractEvents(page, cfg, ctx('2026-11-21T00:00:00Z'))
    expect(r.events.map((e) => [e.open_text, e.start_text])).toEqual([['18:00', '19:00'], [null, '24:00']])
  })

  it('ラベルが無い item は時刻 null（失敗にしない）', () => {
    const r = extractEvents(html([item('12/01', 'A', row('ADV.', '3000'))]), cfg, ctx('2026-11-21T00:00:00Z'))
    expect(r.events[0]?.start_text).toBeNull()
    expect(r.issues).toEqual([])
  })
})

describe('Contract: 年なし日付の年推定（now は JST で解釈）', () => {
  it('12/31 の次の 01/01 は翌年になる', () => {
    const r = extractEvents(html([item('12/30'), item('12/31'), item('01/01'), item('01/02')]), config(), ctx('2026-12-30T03:00:00Z'))
    expect(r.events.map((e) => e.date)).toEqual(['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02'])
  })

  it('先頭の公演は now に最も近い年を採る（12 月に 1 月の公演だけ載っているページ）', () => {
    const r = extractEvents(html([item('01/05')]), config(), ctx('2026-12-30T03:00:00Z'))
    expect(r.events[0]?.date).toBe('2027-01-05')
  })

  it('1 月に前年 12 月の公演が載っていれば前年になる', () => {
    const r = extractEvents(html([item('12/30')]), config(), ctx('2027-01-02T03:00:00Z'))
    expect(r.events[0]?.date).toBe('2026-12-30')
  })

  it('実在しない日付（うるう日でない 2/29）は公演にせず skipped に理由を残す', () => {
    const r = extractEvents(html([item('02/29')]), config(), ctx('2026-11-21T00:00:00Z'))
    expect(r.events).toEqual([])
    expect(r.skipped).toHaveLength(1)
    expect(r.skipped[0]?.reason).toContain('schema validation failed')
  })

  it('year_source があればそちらを使う（推定しない）', () => {
    const cfg = config({
      date: {
        source: { selector: '.d' },
        pattern: '(?<month>\\d{1,2})/(?<day>\\d{1,2})',
        year_source: { source: { from: 'page', selector: 'h1' }, pattern: '(?<year>\\d{4})' }
      }
    })
    const r = extractEvents(`<h1>2031.03</h1>${html([item('03/09')])}`, cfg, ctx('2026-11-21T00:00:00Z'))
    expect(r.events[0]?.date).toBe('2031-03-09')
  })
})

describe('Contract: url_template は now の JST 年月で埋める', () => {
  const template = 'https://example.com/{YYYY}/index_{YYYY}-{MM}.html?m={M}'

  it('UTC では月末でも JST で翌月になっていれば翌月', () => {
    expect(fillUrlTemplate(template, new Date('2026-11-30T14:59:59Z'))).toBe('https://example.com/2026/index_2026-11.html?m=11')
    expect(fillUrlTemplate(template, new Date('2026-11-30T15:00:00Z'))).toBe('https://example.com/2026/index_2026-12.html?m=12')
  })

  it('年末は年も繰り上がり、月は 2 桁（{M} は 0 埋めなし）', () => {
    expect(fillUrlTemplate(template, new Date('2026-12-31T15:00:00Z'))).toBe('https://example.com/2027/index_2027-01.html?m=1')
  })
})

describe('Contract: 時刻は parseShowTime の範囲（0:00〜28:59）で受け入れる', () => {
  const cfg = config({
    times: {
      source: { selector: '.o' },
      patterns: ['OPEN (?<open>\\S+) START (?<start>\\S+)']
    }
  })
  const page = (o: string): string => html([item('12/01', 'A', `<span class="o">${o}</span>`)])

  it('24:30 と 28:59 は受け入れる', () => {
    const r = extractEvents(page('OPEN 24:00 START 24:30'), cfg, ctx('2026-11-21T00:00:00Z'))
    expect([r.events[0]?.open_text, r.events[0]?.start_text]).toEqual(['24:00', '24:30'])
    expect(extractEvents(page('OPEN 28:00 START 28:59'), cfg, ctx('2026-11-21T00:00:00Z')).issues).toEqual([])
  })

  it('29:00 は start を null にして issue を出し、公演自体は残す', () => {
    const r = extractEvents(page('OPEN 18:00 START 29:00'), cfg, ctx('2026-11-21T00:00:00Z'))
    expect(r.events).toHaveLength(1)
    expect(r.events[0]?.open_text).toBe('18:00')
    expect(r.events[0]?.start_text).toBeNull()
    expect(r.issues).toHaveLength(1)
    expect(r.issues[0]).toMatchObject({ code: 'invalid_start_time', field: 'start_text', index: 0 })
  })

  it('不正な書式（分が 60 以上）も issue になる', () => {
    const r = extractEvents(page('OPEN 18:75 START 19:00'), cfg, ctx('2026-11-21T00:00:00Z'))
    expect(r.events[0]?.open_text).toBeNull()
    expect(r.issues[0]).toMatchObject({ code: 'invalid_start_time', field: 'open_text' })
  })
})

describe('Contract: skip と欠損', () => {
  it('skip ルールに合う item は理由つきで捨て、タイトルのない item も skipped に残る', () => {
    const cfg = config({}, { skip: [{ reason: 'maintenance', when: { in: '.t', text_matches: '^メンテナンス$' } }] })
    const r = extractEvents(html([item('12/01', 'メンテナンス'), `<span class="d">12/02</span>`, item('12/03', 'OK')]), cfg, ctx('2026-11-21T00:00:00Z'))
    expect(r.itemCount).toBe(3)
    expect(r.events.map((e) => e.title_ja)).toEqual(['OK'])
    expect(r.skipped.map((s) => s.reason)).toEqual(['maintenance', 'missing title'])
  })

  it('item が 1 つも見つからなければ itemCount 0（レイアウト変更の検知に使える）', () => {
    const r = extractEvents('<body><p>no events</p></body>', config(), ctx('2026-11-21T00:00:00Z'))
    expect(r).toMatchObject({ itemCount: 0, events: [], skipped: [], issues: [] })
  })
})

describe('Contract: status ルールは上から最初に合ったものを採る', () => {
  const cfg = config({
    status: [
      { value: 'cancelled', when: { text_matches: '中止' } },
      { value: 'sold_out', when: { has: '.soldout' } }
    ]
  })

  it('合うものが無ければ null', () => {
    const r = extractEvents(html([item('12/01', '中止のお知らせ'), item('12/02', 'A', '<p class="soldout">x</p>'), item('12/03', 'B')]), cfg, ctx('2026-11-21T00:00:00Z'))
    expect(r.events.map((e) => e.status)).toEqual(['cancelled', 'sold_out', null])
  })
})

describe('Contract: URL の正規化は http(s) の絶対 URL か null', () => {
  const base = 'https://example.com/ja/events'
  it.each([
    ['/ja/events/1', 'https://example.com/ja/events/1'],
    ['t-dv.com/abc', 'https://t-dv.com/abc'],
    ['URL:https://t-dv.com/x', 'https://t-dv.com/x'],
    ['https://a.example/x', 'https://a.example/x'],
    ['mailto:a@example.com', null],
    ['hmailto:a@example.com', null],
    ['info@example.com', null],
    ['plus-fc.com/topics/members…', null],
    ['', null]
  ])('%s', (raw, expected) => {
    expect(normalizeUrl(raw, base)).toBe(expected)
  })
})

describe('Contract: 設定スキーマは未知のキーと壊れた正規表現・セレクタを拒否する', () => {
  const valid = { version: 1, strategy: 'dom', item: '.ev', fields: { date: { source: {}, pattern: 'x' }, title: { sources: [{}], mode: 'first' } } }

  it('最小の設定は通る', () => {
    expect(venueExtractConfigSchema.safeParse(valid).success).toBe(true)
  })

  it('未知のキー・不正な正規表現・条件のない skip は失敗する', () => {
    expect(venueExtractConfigSchema.safeParse({ ...valid, extra: 1 }).success).toBe(false)
    expect(venueExtractConfigSchema.safeParse({ ...valid, fields: { ...valid.fields, date: { source: {}, pattern: '(' } } }).success).toBe(false)
    expect(venueExtractConfigSchema.safeParse({ ...valid, skip: [{ reason: 'r', when: {} }] }).success).toBe(false)
  })
})
