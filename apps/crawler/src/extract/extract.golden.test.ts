import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { extractedEventSchema, type ExtractedEvent } from '@live-info/schema'
import { venueExtractConfigSchema } from './config'
import { extractEvents, type ExtractionResult } from './engine'

// フィクスチャは 2026-11-21 に取得した実ページ。now も同じ日の JST 正午に固定する。
const NOW = new Date('2026-11-21T03:00:00Z')

interface VenueCase {
  id: string
  sourceUrl: string
  itemCount: number
  eventCount: number
}

const VENUES: Record<string, VenueCase> = {
  shelter: { id: 'venue-shimokitazawa-shelter', sourceUrl: 'https://www.loft-prj.co.jp/schedule/shelter/schedule', itemCount: 38, eventCount: 38 },
  loft: { id: 'venue-shinjuku-loft', sourceUrl: 'https://www.loft-prj.co.jp/schedule/loft/schedule', itemCount: 35, eventCount: 34 },
  duo: { id: 'venue-shibuya-duo', sourceUrl: 'https://www.duomusicexchange.com/schedule/2026/index_2026-11.html', itemCount: 31, eventCount: 31 },
  womb: { id: 'venue-shibuya-womb', sourceUrl: 'https://www.womb.co.jp/ja/events', itemCount: 10, eventCount: 10 },
  unit: { id: 'venue-daikanyama-unit', sourceUrl: 'https://www.unit-tokyo.com/schedule/', itemCount: 30, eventCount: 30 }
}

// crawler の tsconfig は workers-types の URL 型なので、node:fs には URL でなくパス文字列を渡す
const read = (path: string): string => readFileSync(resolve(import.meta.dirname, path), 'utf8')

function run(venue: VenueCase): ExtractionResult {
  const config = venueExtractConfigSchema.parse(JSON.parse(read(`../../venue-configs/${venue.id}.json`)))
  const html = read(`../../fixtures/${venue.id}/schedule.html`)
  return extractEvents(html, config, { now: NOW, sourceUrl: venue.sourceUrl, venueId: venue.id })
}

const results = Object.fromEntries(Object.entries(VENUES).map(([key, v]) => [key, run(v)])) as Record<string, ExtractionResult>

// 同じ日に複数あっても、タイトルの一部で 1 件に絞る。見つからなければテストを落とす。
function pick(result: ExtractionResult, date: string, titleIncludes: string): ExtractedEvent {
  const hits = result.events.filter((e) => e.date === date && e.title_ja.includes(titleIncludes))
  if (hits.length !== 1) throw new Error(`expected exactly 1 event for ${date} "${titleIncludes}", got ${hits.length}`)
  return hits[0] as ExtractedEvent
}

const names = (e: ExtractedEvent): string[] => e.artists.map((a) => a.name)

describe('Contract: 5 会場のフィクスチャから抽出した公演はスキーマに通り、件数が実ページの公演数と一致する', () => {
  for (const [key, venue] of Object.entries(VENUES)) {
    it(`${venue.id}: ${venue.itemCount} 件の item から ${venue.eventCount} 公演`, () => {
      const r = results[key] as ExtractionResult
      expect(r.itemCount).toBe(venue.itemCount)
      expect(r.events).toHaveLength(venue.eventCount)
      expect(r.skipped).toHaveLength(venue.itemCount - venue.eventCount)
      for (const e of r.events) expect(extractedEventSchema.safeParse(e).success).toBe(true)
      // 24:00 はあっても 29:00 以上の表記はフィクスチャに無い
      expect(r.issues).toEqual([])
    })

    it(`${venue.id}: 公演は DOM 順（日付は昇順）`, () => {
      const dates = (results[key] as ExtractionResult).events.map((e) => e.date)
      expect(dates).toEqual([...dates].sort())
    })
  }
})

describe('Contract: 下北沢SHELTER', () => {
  const r = results['shelter'] as ExtractionResult

  it('open が空のカードは時刻 null・出演者なしで、同じ日の 2 カードは別公演になる', () => {
    const day1 = r.events.filter((e) => e.date === '2026-11-01')
    expect(day1.map((e) => e.title_ja)).toEqual(['SHELTER 35th Anniversary Finale “ZeppがSHELTERになります”DAY1', '『KNOCKOUT FES 2026』'])
    for (const e of day1) {
      expect(e.open_text).toBeNull()
      expect(e.start_text).toBeNull()
      expect(e.artists).toEqual([])
    }
    expect(day1[0]?.source_url).toBe('https://www.loft-prj.co.jp/schedule/shelter/362047')
  })

  it('START のみの表記は open null・start だけ入る', () => {
    const e = pick(r, '2026-11-20', 'YURERUKO')
    expect([e.open_text, e.start_text]).toEqual([null, '19:30'])
    expect(names(e)).toEqual(['YURERUKO'])
  })

  it('OPEN と START が同時刻でもそのまま返す', () => {
    const e = pick(r, '2026-11-18', 'Y.A,Y')
    expect([e.open_text, e.start_text]).toEqual(['18:00', '18:00'])
  })

  it('.soldout（予約締切）は完売と断定できないので status は null のまま', () => {
    const e = pick(r, '2026-11-03', 'ARJP')
    expect(e.status).toBeNull()
    expect([e.open_text, e.start_text]).toEqual(['11:30', '12:00'])
    expect(names(e)).toEqual(['Nikoん', 'arko lemming', '快速東京'])
  })

  it('出演者末尾の省略記号 <li>...</li> は出演者に入れない', () => {
    expect(names(pick(r, '2026-11-28', 'OUTLAW SCUMFUC'))).toEqual(['流血ブリザード', 'STUPID BABIES GO MAD', '☆HISATAKA☆'])
    expect(names(pick(r, '2026-11-06', '日台音楽交流3DAYS'))).toEqual(['さらば帝国', 'LOLOET', 'ヤスエでんじゃらすおじさん'])
  })

  it('空白の連続は 1 つに畳まれる（タイトルの二重スペース）', () => {
    expect(pick(r, '2026-11-02', 'DAY2').title_ja).toBe('SHELTER 35th Anniversary Finale “ZeppがSHELTERになります”DAY2')
  })
})

describe('Contract: 新宿LOFT', () => {
  const r = results['loft'] as ExtractionResult

  it('メンテナンスのカードは公演にせず、理由つきで skipped に入る', () => {
    expect(r.skipped).toHaveLength(1)
    expect(r.skipped[0]?.reason).toBe('non-event: maintenance')
    expect(r.skipped[0]?.snippet).toContain('メンテナンス')
    expect(r.events.some((e) => e.date === '2026-11-02')).toBe(false)
  })

  it('24:00 開演（深夜）はそのまま start_text に入り、日付は興行日のまま', () => {
    const e = pick(r, '2026-11-13', 'DOTHEMOSH2026')
    expect([e.open_text, e.start_text]).toEqual(['23:30', '24:00'])
    expect(names(e)).toEqual(['サーキットイベント'])
    const e2 = pick(r, '2026-11-14', 'MIDNIGHT RUN')
    expect([e2.open_text, e2.start_text]).toEqual(['23:30', '24:00'])
  })

  it('1 桁時の 9:00 は 09:00 に揃える', () => {
    const e = pick(r, '2026-11-22', 'ともだちフェス2026')
    expect([e.open_text, e.start_text]).toEqual(['09:00', '09:30'])
  })

  it('...・and more… は出演者に入れない', () => {
    expect(names(pick(r, '2026-11-01', 'TOO MUCH TOO OLD'))).toEqual(['THE AUTOCRATICS', 'SEVEN STEP', 'THE REDEMPTION'])
    expect(names(pick(r, '2026-11-15', 'TOYROCK'))).toEqual(['toybee'])
  })

  it('同じ日の昼夜 2 部は別公演', () => {
    const day = r.events.filter((e) => e.date === '2026-11-14')
    expect(day.map((e) => e.start_text)).toEqual(['11:45', '17:30', '24:00'])
  })

  it('詳細 URL が source_url になる', () => {
    expect(pick(r, '2026-11-03', 'Ecotone').source_url).toBe('https://www.loft-prj.co.jp/schedule/loft/schedule/361094')
  })
})

describe('Contract: 渋谷duo MUSIC EXCHANGE', () => {
  const r = results['duo'] as ExtractionResult

  it('dt ラベルが OPEN/START の dd から open/start を取る（日付は直前の a[name=YYMMDD]）', () => {
    const e = pick(r, '2026-11-01', 'STARDUST MEMORY')
    expect([e.open_text, e.start_text]).toEqual(['11:45', '12:15'])
    expect(e.ticket_url).toBe('https://l-tike.com/stardustmemory/')
    expect(e.source_url).toBe('https://www.duomusicexchange.com/schedule/2026/index_2026-11.html')
  })

  it('空の OPEN/START は null、告知だけの公演は ticket_url も null', () => {
    const e = pick(r, '2026-11-02', 'ROAD TO 武道館')
    expect([e.open_text, e.start_text, e.ticket_url]).toEqual([null, null, null])
    expect(names(e)).toEqual(['HIPPY'])
  })

  it('24:00 の単独値は start に入れ、同じ日付の昼公演とは別公演', () => {
    const day = r.events.filter((e) => e.date === '2026-11-21')
    expect(day).toHaveLength(2)
    expect([day[0]?.open_text, day[0]?.start_text]).toEqual(['15:00', '16:00'])
    expect([day[1]?.open_text, day[1]?.start_text]).toEqual([null, '24:00'])
    // 【ALLNIGHT】の装飾は出演者名から外す
    expect(names(day[1] as ExtractedEvent)).toEqual(['JAH WORKS SOUND SYSTEM'])
  })

  it('1 日 2 部の表記は先頭の部の時刻を採る', () => {
    const e = pick(r, '2026-11-12', '#LuvCode:047')
    expect([e.open_text, e.start_text]).toEqual(['13:45', '14:30'])
    expect(e.ticket_url).toBe('https://livepocket.jp/e/l20261112_1')
  })

  it('スラッシュの前後に空白がない 12:00/13:00 も読める', () => {
    const e = pick(r, '2026-11-18', 'YANFES')
    expect([e.open_text, e.start_text]).toEqual(['12:00', '13:00'])
  })

  it('スキームのないチケット URL は https を補い、出演者は <br> と / で分ける', () => {
    expect(pick(r, '2026-11-04', 'なみだ色の消しごむ').ticket_url).toBe('https://t-dv.com/nmks_1104')
    expect(names(pick(r, '2026-11-05', 'まるごと山梨収穫祭'))).toEqual(['サンドアート集団SILT', '船本恵太＆大塚玲子', 'DRB', 'UCCA Band'])
  })

  it('タイトルが空なら .artist で補い、料金は price_text に入る', () => {
    const e = pick(r, '2026-11-15', 'exPoP')
    expect(e.title_ja).toBe('『exPoP!!!!!再会 2026』')
    expect(e.price_text).toContain('ADV.¥8,500')
  })

  it('完売表記が無いので status は全件 null', () => {
    expect(r.events.every((e) => e.status === null)).toBe(true)
  })
})

describe('Contract: 渋谷WOMB（トップページの SSR カード）', () => {
  const r = results['womb'] as ExtractionResult

  it('年なしの日付は now（2026-11-21）から 2026 年と推定し、月をまたいでも同じ年', () => {
    expect(r.events.map((e) => e.date)).toEqual([
      '2026-11-21', '2026-11-22', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28', '2026-12-02', '2026-12-03', '2026-12-04'
    ])
  })

  it('23:00-4:30 は start=23:00 とし終了時刻は捨てる（open なし）', () => {
    const e = pick(r, '2026-11-21', 'HOUSETRIBE')
    expect([e.open_text, e.start_text]).toEqual([null, '23:00'])
    expect(names(e)).toEqual(['Nausica', 'YAMARIKI', 'CARTOON', 'Addiy', 'Chika Luna', 'PUNK N MATRIX', 'Juni'])
  })

  it('括弧つきの注記があっても先頭の開始時刻だけ採る', () => {
    expect(pick(r, '2026-12-03', 'CROSSFADES').start_text).toBe('21:00')
  })

  it('詳細 URL は相対パスを取得 URL で絶対化する', () => {
    expect(pick(r, '2026-11-21', 'HOUSETRIBE').source_url).toBe('https://www.womb.co.jp/ja/events/112126')
  })

  it('タイトルに出演者名を含む公演も title と artists を取り違えない', () => {
    const e = pick(r, '2026-11-22', 'JOSEPH CAPRIATI')
    expect(e.title_ja).toBe('NEWNEU. SYNAPSE. PRESENTS JOSEPH CAPRIATI')
    expect(names(e)[0]).toBe('Joseph Capriati')
    expect(names(e)).toHaveLength(11)
  })
})

describe('Contract: 代官山UNIT', () => {
  const r = results['unit'] as ExtractionResult

  it('年はページ見出し（2026.11）から取り、日付は 11/01 形式から作る', () => {
    expect(r.events[0]?.date).toBe('2026-11-01')
    expect(r.events.at(-1)?.date).toBe('2026-11-29')
  })

  it('title-top / title / title-bottom を連結し、出演者は / で分ける', () => {
    const e = pick(r, '2026-11-01', 'A NEW ERA')
    expect(e.title_ja).toBe('Mark Boals x Kelly SIMONZ A NEW ERA at Daikanyama UNIT')
    expect(names(e)).toEqual(['Mark Boals', 'Kelly SIMONZ'])
    expect([e.open_text, e.start_text]).toEqual(['18:00', null])
    expect(e.source_url).toBe('https://www.unit-tokyo.com/schedule/14979/')
  })

  it('【公演中止】は cancelled、それ以外は null', () => {
    expect(pick(r, '2026-11-08', 'IN n’ OUT').status).toBe('cancelled')
    expect(r.events.filter((e) => e.status !== null)).toHaveLength(1)
  })

  it('open も出演者もないカードは時刻 null・出演者なし', () => {
    const e = pick(r, '2026-11-07', 'TOKYO SKI NIGHT')
    expect([e.open_text, e.start_text, e.artists]).toEqual([null, null, []])
  })

  it('同じ日の 2 部は別公演（青木葉 13:00 と 17:15）', () => {
    const day = r.events.filter((e) => e.date === '2026-11-29')
    expect(day.map((e) => e.open_text)).toEqual(['13:00', '17:15'])
  })

  it('※順不同 は出演者名から外す', () => {
    const day = r.events.filter((e) => e.date === '2026-11-14')
    expect(day).toHaveLength(2)
    for (const e of day) expect(names(e).some((n) => n.includes('※'))).toBe(false)
  })
})
