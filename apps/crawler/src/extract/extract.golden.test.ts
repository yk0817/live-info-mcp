import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { extractedEventSchema, type ExtractedEvent } from '@live-info/schema'
import { venueExtractConfigSchema } from './config'
import { extractEvents, type ExtractionResult } from './engine'

// フィクスチャは実ページの DOM 構造だけを模した合成データ（架空の公演）。now は 2026-11-21 の JST 正午に固定する。
const NOW = new Date('2026-11-21T03:00:00Z')

interface VenueCase {
  id: string
  sourceUrl: string
  itemCount: number
  eventCount: number
  // ページの並びが日付順でない会場（La.mama は「今後 → 翌月 → 終了分」の順）は false
  domOrderIsDateOrder?: false
}

const VENUES: Record<string, VenueCase> = {
  shelter: { id: 'venue-shimokitazawa-shelter', sourceUrl: 'https://www.loft-prj.co.jp/schedule/shelter/schedule', itemCount: 9, eventCount: 9 },
  loft: { id: 'venue-shinjuku-loft', sourceUrl: 'https://www.loft-prj.co.jp/schedule/loft/schedule', itemCount: 14, eventCount: 13 },
  duo: { id: 'venue-shibuya-duo', sourceUrl: 'https://www.duomusicexchange.com/schedule/2026/index_2026-11.html', itemCount: 11, eventCount: 11 },
  womb: { id: 'venue-shibuya-womb', sourceUrl: 'https://www.womb.co.jp/ja/events', itemCount: 6, eventCount: 6 },
  unit: { id: 'venue-daikanyama-unit', sourceUrl: 'https://www.unit-tokyo.com/schedule/', itemCount: 9, eventCount: 9 },
  // batch 1（渋谷近郊）
  onest: { id: 'venue-shibuya-o-nest', sourceUrl: 'https://shibuya-o.com/nest/schedule/?y=2026&m=11', itemCount: 5, eventCount: 5 },
  ocrest: { id: 'venue-shibuya-o-crest', sourceUrl: 'https://shibuya-o.com/crest/schedule/?y=2026&m=11', itemCount: 3, eventCount: 3 },
  owest: { id: 'venue-shibuya-o-west', sourceUrl: 'https://shibuya-o.com/west/schedule/?y=2026&m=11', itemCount: 3, eventCount: 3 },
  quattro: { id: 'venue-shibuya-quattro', sourceUrl: 'https://www.club-quattro.com/shibuya/schedule/?ym=202611', itemCount: 4, eventCount: 4 },
  lamama: { id: 'venue-shibuya-lamama', sourceUrl: 'https://www.lamama.net/schedule/?month=2026-11', itemCount: 4, eventCount: 4, domOrderIsDateOrder: false },
  spaceodd: { id: 'venue-daikanyama-spaceodd', sourceUrl: 'https://spaceodd.jp/schedule/?event_year=2026&event_month=11', itemCount: 5, eventCount: 4 },
  circus: { id: 'venue-shibuya-circus', sourceUrl: 'https://circus-tokyo.jp/schedule/', itemCount: 4, eventCount: 4 },
  batica: { id: 'venue-ebisu-batica', sourceUrl: 'https://batica.jp/events/', itemCount: 4, eventCount: 3 },
  solfa: { id: 'venue-nakameguro-solfa', sourceUrl: 'https://nakameguro-solfa.com/events/', itemCount: 4, eventCount: 3 },
  theroom: { id: 'venue-shibuya-theroom', sourceUrl: 'https://theroom.jp/schedule/?ym=2026-11', itemCount: 4, eventCount: 4 }
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

describe('Contract: 各会場のフィクスチャから抽出した公演はスキーマに通り、件数がフィクスチャの公演数と一致する', () => {
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

    if (venue.domOrderIsDateOrder !== false) {
      it(`${venue.id}: 公演は DOM 順（日付は昇順）`, () => {
        const dates = (results[key] as ExtractionResult).events.map((e) => e.date)
        expect(dates).toEqual([...dates].sort())
      })
    }
  }
})

describe('Contract: 下北沢SHELTER', () => {
  const r = results['shelter'] as ExtractionResult

  it('open が空のカードは時刻 null・出演者なしで、同じ日の 2 カードは別公演になる', () => {
    const day = r.events.filter((e) => e.date === '2026-11-29')
    expect(day.map((e) => e.title_ja)).toEqual(['Sample Anniversary Finale “テスト会場になります”DAY1', '『SAMPLE FES 2026』'])
    for (const e of day) {
      expect(e.open_text).toBeNull()
      expect(e.start_text).toBeNull()
      expect(e.artists).toEqual([])
    }
    expect(day[0]?.source_url).toBe('https://www.loft-prj.co.jp/schedule/shelter/900129')
  })

  it('START のみの表記は open null・start だけ入る', () => {
    const e = pick(r, '2026-11-20', 'テストシンガーC')
    expect([e.open_text, e.start_text]).toEqual([null, '19:30'])
    expect(names(e)).toEqual(['テストシンガーC'])
  })

  it('OPEN と START が同時刻でもそのまま返す', () => {
    const e = pick(r, '2026-11-18', 'Sample Showcase')
    expect([e.open_text, e.start_text]).toEqual(['18:00', '18:00'])
  })

  it('.soldout（予約締切）は完売と断定できないので status は null のまま', () => {
    const e = pick(r, '2026-11-03', '予約締切ナイト')
    expect(e.status).toBeNull()
    expect([e.open_text, e.start_text]).toEqual(['11:30', '12:00'])
    expect(names(e)).toEqual(['テストバンドA', 'Sample DJ', '架空楽団'])
  })

  it('出演者末尾の省略記号 <li>...</li> は出演者に入れない', () => {
    expect(names(pick(r, '2026-11-28', 'Fictional Punk Night'))).toEqual(['架空ブリザード', 'SAMPLE BABIES', '☆テスト☆'])
    expect(names(pick(r, '2026-11-06', '架空音楽交流3DAYS'))).toEqual(['テストバンドB', 'Sample Trio', '架空おじさんズ'])
  })

  it('空白の連続は 1 つに畳まれる（タイトルの二重スペース）', () => {
    expect(pick(r, '2026-11-30', 'DAY2').title_ja).toBe('Sample Anniversary Finale “テスト会場になります”DAY2')
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
    const e = pick(r, '2026-11-13', 'SAMPLEMOSH2026')
    expect([e.open_text, e.start_text]).toEqual(['23:30', '24:00'])
    expect(names(e)).toEqual(['テストサーキット'])
    const e2 = pick(r, '2026-11-14', 'MIDNIGHT RUN')
    expect([e2.open_text, e2.start_text]).toEqual(['23:30', '24:00'])
  })

  it('1 桁時の 9:00 は 09:00 に揃える', () => {
    const e = pick(r, '2026-11-22', 'テスト朝フェス2026')
    expect([e.open_text, e.start_text]).toEqual(['09:00', '09:30'])
  })

  it('...・and more… は出演者に入れない', () => {
    expect(names(pick(r, '2026-11-01', 'Sample Old School Night'))).toEqual(['THE SAMPLES', 'TEST STEP', 'THE FICTIONS'])
    expect(names(pick(r, '2026-11-15', 'TESTTOYROCK'))).toEqual(['testtoy'])
  })

  it('同じ日の昼夜 2 部は別公演', () => {
    const day = r.events.filter((e) => e.date === '2026-11-14')
    expect(day.map((e) => e.start_text)).toEqual(['11:45', '17:30', '24:00'])
  })

  it('詳細 URL が source_url になる', () => {
    expect(pick(r, '2026-11-03', 'Ecotone').source_url).toBe('https://www.loft-prj.co.jp/schedule/loft/schedule/900103')
  })
})

describe('Contract: 渋谷duo MUSIC EXCHANGE', () => {
  const r = results['duo'] as ExtractionResult

  it('dt ラベルが OPEN/START の dd から open/start を取る（日付は直前の a[name=YYMMDD]）', () => {
    const e = pick(r, '2026-11-01', 'SAMPLE MEMORY')
    expect([e.open_text, e.start_text]).toEqual(['11:45', '12:15'])
    expect(e.ticket_url).toBe('https://tickets.example.com/samplememory/')
    expect(e.source_url).toBe('https://www.duomusicexchange.com/schedule/2026/index_2026-11.html')
  })

  it('空の OPEN/START は null、告知だけの公演は ticket_url も null', () => {
    const e = pick(r, '2026-11-02', 'ROAD TO 架空ホール')
    expect([e.open_text, e.start_text, e.ticket_url]).toEqual([null, null, null])
    expect(names(e)).toEqual(['テスト歌手D'])
  })

  it('24:00 の単独値は start に入れ、同じ日付の昼公演とは別公演', () => {
    const day = r.events.filter((e) => e.date === '2026-11-21')
    expect(day).toHaveLength(2)
    expect([day[0]?.open_text, day[0]?.start_text]).toEqual(['15:00', '16:00'])
    expect([day[1]?.open_text, day[1]?.start_text]).toEqual([null, '24:00'])
    // 【ALLNIGHT】の装飾は出演者名から外す
    expect(names(day[1] as ExtractedEvent)).toEqual(['SAMPLE SOUND SYSTEM'])
  })

  it('1 日 2 部の表記は先頭の部の時刻を採る', () => {
    const e = pick(r, '2026-11-12', '#SampleCode:047')
    expect([e.open_text, e.start_text]).toEqual(['13:45', '14:30'])
    expect(e.ticket_url).toBe('https://tickets.example.com/e/l20261112_1')
  })

  it('スラッシュの前後に空白がない 12:00/13:00 も読める', () => {
    const e = pick(r, '2026-11-18', 'SAMPLEFES')
    expect([e.open_text, e.start_text]).toEqual(['12:00', '13:00'])
  })

  it('スキームのないチケット URL は https を補い、出演者は <br> と / で分ける', () => {
    expect(pick(r, '2026-11-04', '架空の消しごむ').ticket_url).toBe('https://tickets.example.com/test_1104')
    expect(names(pick(r, '2026-11-05', 'まるごと架空県収穫祭'))).toEqual(['サンプル砂絵集団', 'テスト奏者＆架空歌手', 'Sample Band E', 'Test Band F'])
  })

  it('タイトルが空なら .artist で補い、料金は price_text に入る', () => {
    const e = pick(r, '2026-11-15', 'SamPoP')
    expect(e.title_ja).toBe('『SamPoP!!!!!再会 2026』')
    expect(e.price_text).toContain('ADV.¥8,500')
  })

  it('完売表記が無いので status は全件 null', () => {
    expect(r.events.every((e) => e.status === null)).toBe(true)
  })
})

describe('Contract: 渋谷WOMB（トップページの SSR カード）', () => {
  const r = results['womb'] as ExtractionResult

  it('年なしの日付は now（2026-11-21）から 2026 年と推定し、月をまたいでも同じ年、1 月に戻ったら翌年', () => {
    expect(r.events.map((e) => e.date)).toEqual(['2026-11-21', '2026-11-22', '2026-11-28', '2026-12-02', '2026-12-03', '2027-01-09'])
  })

  it('23:00-4:30 は start=23:00 とし終了時刻は捨てる（open なし）', () => {
    const e = pick(r, '2026-11-21', 'SAMPLETRIBE')
    expect([e.open_text, e.start_text]).toEqual([null, '23:00'])
    expect(names(e)).toEqual(['Sample DJ A', 'テストDJ B', 'Fictional C', 'Test D'])
  })

  it('括弧つきの注記があっても先頭の開始時刻だけ採る', () => {
    expect(pick(r, '2026-12-03', 'CROSSFADES').start_text).toBe('21:00')
  })

  it('詳細 URL は相対パスを取得 URL で絶対化する', () => {
    expect(pick(r, '2026-11-21', 'SAMPLETRIBE').source_url).toBe('https://www.womb.co.jp/ja/events/900121')
  })

  it('タイトルに出演者名を含む公演も title と artists を取り違えない', () => {
    const e = pick(r, '2026-11-22', 'FICTIONAL HEADLINER')
    expect(e.title_ja).toBe('SAMPLE NIGHTS PRESENTS FICTIONAL HEADLINER')
    expect(names(e)[0]).toBe('Fictional Headliner')
    expect(names(e)).toHaveLength(5)
  })
})

describe('Contract: 代官山UNIT', () => {
  const r = results['unit'] as ExtractionResult

  it('年はページ見出し（2026.11）から取り、日付は 11/01 形式から作る', () => {
    expect(r.events[0]?.date).toBe('2026-11-01')
    expect(r.events.at(-1)?.date).toBe('2026-11-29')
  })

  it('title-top / title / title-bottom を連結し、出演者は / で分ける', () => {
    const e = pick(r, '2026-11-01', 'A NEW TEST')
    expect(e.title_ja).toBe('Sample Singer x Test Guitarist A NEW TEST at Daikanyama UNIT')
    expect(names(e)).toEqual(['Sample Singer', 'Test Guitarist'])
    expect([e.open_text, e.start_text]).toEqual(['18:00', null])
    expect(e.source_url).toBe('https://www.unit-tokyo.com/schedule/900001/')
  })

  it('【公演中止】は cancelled、それ以外は null', () => {
    expect(pick(r, '2026-11-08', 'IN n’ TEST').status).toBe('cancelled')
    expect(r.events.filter((e) => e.status !== null)).toHaveLength(1)
  })

  it('open も出演者もないカードは時刻 null・出演者なし', () => {
    const e = pick(r, '2026-11-07', 'TEST SKI NIGHT')
    expect([e.open_text, e.start_text, e.artists]).toEqual([null, null, []])
  })

  it('同じ日の 2 部は別公演（同じタイトルの 13:00 と 17:15）', () => {
    const day = r.events.filter((e) => e.date === '2026-11-29')
    expect(day.map((e) => e.open_text)).toEqual(['13:00', '17:15'])
  })

  it('※順不同 は出演者名から外す', () => {
    const day = r.events.filter((e) => e.date === '2026-11-14')
    expect(day).toHaveLength(2)
    for (const e of day) expect(names(e).some((n) => n.includes('※'))).toBe(false)
    expect(names(day[0] as ExtractedEvent)).toEqual(['架空ユニットO', '架空ユニットP', '架空ユニットQ'])
  })
})

describe('Contract: 渋谷 O-nest / O-Crest / O-WEST（shibuya-o.com 共通テーマ）', () => {
  const nest = results['onest'] as ExtractionResult

  it('年は URL の y、日付は「11 / 01」から作り、OPEN / START を open/start に分ける', () => {
    const e = pick(nest, '2026-11-01', '架空生誕祭2026')
    expect([e.open_text, e.start_text]).toEqual(['10:45', '11:15'])
    expect(names(e)).toEqual(['テストアイドルA'])
    expect(e.source_url).toBe('https://shibuya-o.com/nest/schedule/sample-birthday-900101/')
  })

  it('SOLD OUT のカードだけ sold_out、ほかは null。出演者末尾の空白は落とす', () => {
    const e = pick(nest, '2026-11-01', 'Re:TEST')
    expect(e.status).toBe('sold_out')
    expect(names(e)).toEqual(['Sample Band', 'Fictional Guest', 'Test Opener'])
    expect(nest.events.filter((x) => x.status !== null)).toHaveLength(1)
  })

  it('title-top / main / bottom を連結し、全角空白だけの出演者欄は出演者なし', () => {
    const e = pick(nest, '2026-11-14', 'テスト楽団')
    expect(e.title_ja).toBe('架空レコーズ presents テスト楽団 / サンプル合奏団 「架空と試験の夜」')
    expect(e.artists).toEqual([])
  })

  it('同じ日の 1 部・2 部は別公演', () => {
    expect(nest.events.filter((e) => e.date === '2026-11-28').map((e) => e.start_text)).toEqual(['11:30', '18:00'])
  })

  it('O-Crest と O-WEST も同じ設定構造で読め、SOLD OUT は sold_out', () => {
    const crest = results['ocrest'] as ExtractionResult
    expect(pick(crest, '2026-11-03', 'NEXT SAMPLE').title_ja).toBe('O-Crest pre. NEXT SAMPLE')
    expect(pick(crest, '2026-11-24', 'SAMPLE KISS').status).toBe('sold_out')
    const west = results['owest'] as ExtractionResult
    const e = pick(west, '2026-11-22', 'iDOL SAMPLE')
    expect([e.open_text, e.start_text]).toEqual(['18:20', '19:00'])
    expect(names(e)).toEqual(['テストシーン', 'さんぷるきゅおん！', 'myotest'])
    // 出演者欄（ul）が無いカードも公演として残る
    expect(pick(west, '2026-11-05', 'サンプル全国編').artists).toEqual([])
  })
})

describe('Contract: 渋谷CLUB QUATTRO', () => {
  const r = results['quattro'] as ExtractionResult

  it('日付は data-event-date、時刻は dt「開場/開演」の dd、料金は dt「料金」の dd', () => {
    const e = pick(r, '2026-11-01', 'Look TEST')
    expect([e.open_text, e.start_text]).toEqual(['17:15', '18:00'])
    expect(e.price_text).toBe('前売 ￥4,400')
    expect(names(e)).toEqual(['sample'])
    expect(e.source_url).toBe('https://www.club-quattro.com/shibuya/schedule/detail/?cd=900101')
  })

  it('出演者は / で分け、（※順不同) を外す', () => {
    expect(names(pick(r, '2026-11-03', 'DREAM TEST'))).toEqual(['THE SAMPLEGUGU', 'テストティカ', 'ARCHIVE WALKER(S)'])
  })

  it('「1回目 … 2回目 …」は先頭の回の時刻を採る', () => {
    const e = pick(r, '2026-11-08', 'THE FICTIONS 2DAYS')
    expect([e.open_text, e.start_text]).toEqual(['15:30', '16:00'])
  })

  it('公演名が空なら出演者欄で補い、出演者は <br> でも分ける', () => {
    const e = pick(r, '2026-11-23', 'TestNoboAz')
    expect(names(e)).toEqual(['TestNoboAz', 'SAMPLE BOYS'])
  })
})

describe('Contract: 渋谷La.mama', () => {
  const r = results['lamama'] as ExtractionResult

  it('日付は data-schedule から取り、並びは「今後 → 翌月 → 終了分」の DOM 順のまま', () => {
    expect(r.events.map((e) => e.date)).toEqual(['2026-11-21', '2026-11-21', '2026-12-03', '2026-11-01'])
  })

  it('一覧に時刻はなく、同じ日の DAY と NIGHT は時刻 null の別公演', () => {
    const day = r.events.filter((e) => e.date === '2026-11-21')
    expect(day.map((e) => e.source_url)).toEqual(['https://www.lamama.net/article/s-20261121-d/', 'https://www.lamama.net/article/s-20261121-n/'])
    for (const e of day) expect([e.open_text, e.start_text]).toEqual([null, null])
  })

  it('「MC：」の前置きと末尾の「他」「ほか」を外し、※ の注記は出演者に入れない', () => {
    expect(names(pick(r, '2026-11-21', '架空新人コント大会'))).toEqual(['テスト司会者', 'サンプル芸人（架空コンビ）'])
    expect(names(pick(r, '2026-11-21', '架空ナイト'))).toEqual(['TEST KICHI-GUY GENERATION', '架空太郎'])
  })

  it('(O.A.) の前置きを外し、and more… は出演者に入れない', () => {
    expect(names(pick(r, '2026-12-03', 'DAYTEST'))).toEqual(['架空歌手(テストバンド)', 'サンプル奏者', 'FICTIONS'])
  })
})

describe('Contract: 代官山SPACE ODD', () => {
  const r = results['spaceodd'] as ExtractionResult

  it('「Coming soon…」の仮カードは公演にせず、理由つきで skipped に入る（独自タグ d のカードだけを item にする）', () => {
    expect(r.skipped.map((s) => s.reason)).toEqual(['placeholder: coming soon'])
    expect(r.events.some((e) => e.date === '2026-11-01')).toBe(false)
  })

  it('日付はカードの「2026. 11.05」、時刻は「OPEN/START： 19:00/19:30」から取る', () => {
    const e = pick(r, '2026-11-05', 'Sample Custom 6-Day1')
    expect([e.open_text, e.start_text]).toEqual(['19:00', '19:30'])
    expect(e.source_url).toBe('https://spaceodd.jp/sample-custom-day1/')
  })

  it('ラベルが二重の「OPEN/START： OPEN/START:18:15/19:00」も読める', () => {
    const e = pick(r, '2026-11-06', 'Day2')
    expect([e.open_text, e.start_text]).toEqual(['18:15', '19:00'])
  })

  it('時刻のないカードは時刻 null・出演者なし', () => {
    const e = pick(r, '2026-11-03', 'DIVE TEST')
    expect([e.open_text, e.start_text, e.artists]).toEqual([null, null, []])
  })
})

describe('Contract: 渋谷Circus Tokyo', () => {
  const r = results['circus'] as ExtractionResult

  it('「2026-11-21 - 23:00 - 2026-11-22 - 05:00」は興行日 11/21・start=23:00（終了は捨てる）', () => {
    const e = pick(r, '2026-11-21', 'FOR FRIENDS')
    expect([e.open_text, e.start_text]).toEqual([null, '23:00'])
    expect(e.source_url).toBe('https://circus-tokyo.jp/event/sample-for-friends/')
  })

  it('タイトルの【SOLD OUT】は sold_out に写し、ほかは null', () => {
    expect(pick(r, '2026-11-28', 'Fictional Bumpa').status).toBe('sold_out')
    expect(r.events.filter((e) => e.status !== null)).toHaveLength(1)
  })

  it('年は表記どおり（翌年 2 月の公演は 2027 年）', () => {
    expect(pick(r, '2027-02-04', 'SECOND SHOW').start_text).toBe('19:00')
  })
})

describe('Contract: 恵比寿BATICA / 中目黒solfa（The Events Calendar の月表示）', () => {
  const batica = results['batica'] as ExtractionResult
  const solfa = results['solfa'] as ExtractionResult

  it('日付はツールチップの time[datetime]、最初の time[datetime] を open にする（終了時刻は捨てる）', () => {
    const e = pick(batica, '2026-11-03', 'kids test')
    expect([e.open_text, e.start_text]).toEqual(['23:30', null])
    expect(e.source_url).toBe('https://batica.jp/events/kids-test-vol-2/')
  })

  it('前月の週の端の日の公演もそのまま入り、同じ日の昼夜は別公演', () => {
    expect(batica.events[0]?.date).toBe('2026-10-31')
    expect(batica.events.filter((e) => e.date === '2026-11-03').map((e) => e.open_text)).toEqual(['16:00', '23:30'])
  })

  it('「TBA」の仮枠は skip し、モバイル用の複製は数えない', () => {
    expect(batica.skipped.map((s) => s.reason)).toEqual(['placeholder: TBA'])
    expect(batica.events.filter((e) => e.title_ja === 'TEST BOX')).toHaveLength(1)
  })

  it('solfa の休業日（終日の CLOSED）は item にならず、翌月頭の公演は入る', () => {
    expect(solfa.events.some((e) => e.title_ja === 'CLOSED')).toBe(false)
    expect(solfa.events.map((e) => e.date)).toEqual(['2026-11-07', '2026-11-07', '2026-12-04'])
    expect(pick(solfa, '2026-11-07', 'THE TEST').open_text).toBe('23:00')
    expect(solfa.skipped.map((s) => s.reason)).toEqual(['placeholder: TBA'])
  })
})

describe('Contract: 渋谷THE ROOM', () => {
  const r = results['theroom'] as ExtractionResult

  it('日付は「2026-11-03 TUE」から取り、一覧に時刻はない', () => {
    const e = pick(r, '2026-11-03', 'SAMPLE PREMIUM LOUNGE')
    expect([e.open_text, e.start_text]).toEqual([null, null])
    expect(e.source_url).toBe('https://theroom.jp/schedule/900103/')
  })

  it('出演者は <br> で分け、[DJ] [GUEST DJ] の見出し行は捨て、/ を含む名前は分けない', () => {
    expect(names(pick(r, '2026-11-03', 'SAMPLE PREMIUM LOUNGE'))).toEqual(['TEST KURODA/架空大介 (sample)', 'DJ FICTION (TESTSTER)', 'DJ SAMPLESAKI (SAMPLE RECORDS)'])
    expect(names(pick(r, '2026-11-04', 'noi-test'))).toEqual(['Testo Samplewandt', 'DJ SAMPLE!a', 'dj Kakuu'])
  })

  it('行頭の [LIVE] 見出しは外し、同じ日の LIVE と DJ は別公演', () => {
    expect(names(pick(r, '2026-11-28', 'ROOT TEST'))[0]).toBe('"ROOT TEST"')
    expect(r.events.filter((e) => e.date === '2026-11-28')).toHaveLength(2)
  })
})

