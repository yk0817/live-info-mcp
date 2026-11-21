import { beforeEach, describe, expect, it } from 'vitest'
import type { ExtractedEvent } from '@live-info/schema'
import { createMigratedDb } from '../../../../test-utils/d1'
import { storeEvents } from './index'

const VENUE = 'venue-shibuya-duo'
const T0 = new Date('2026-11-21T03:00:00Z')
const T1 = new Date('2026-11-21T04:00:00Z')

const ev = (over: Partial<ExtractedEvent> = {}): ExtractedEvent => ({
  title_ja: 'Live A',
  date: '2026-12-01',
  open_text: '18:30',
  start_text: '19:00',
  price_text: null,
  price_min_jpy: null,
  status: null,
  ticket_url: null,
  source_url: 'https://example.com/a',
  artists: [{ name: 'Band A' }],
  ...over
})

let db: D1Database

beforeEach(async () => {
  db = createMigratedDb()
  await db.exec(
    `INSERT INTO venues (id, name_ja, prefecture, venue_kind) VALUES ('${VENUE}', 'duo', '東京都', 'livehouse');
     INSERT INTO sources (id, kind, url, parser) VALUES ('src_${VENUE}', 'venue', 'https://example.com/', 'rule');`
  )
})

const store = (events: ExtractedEvent[], now = T0, needsReview = false) =>
  storeEvents({ db, venueId: VENUE, sourceId: `src_${VENUE}`, rawKey: 'raw/k.html', now, events: events.map((event) => ({ event, needsReview })) })

const all = async <T>(sql: string, ...p: unknown[]): Promise<T[]> => (await db.prepare(sql).bind(...p).all<T>()).results

describe('Contract: 同一公演の判定（requirements 設計判断 1）', () => {
  // Contract: start が同じで出演者が重なれば、タイトルが変わっても同一公演（id・first_seen_at を保ったまま更新する）
  it('規則 1: 同じ start と重なる出演者なら同一。タイトルの変更は更新になる', async () => {
    await store([ev()])
    const [before] = await all<{ id: string }>('SELECT id FROM events')
    const summary = await store([ev({ title_ja: 'Live A (renamed)' })], T1)
    const rows = await all<{ id: string; title_ja: string; first_seen_at: string; updated_at: string }>('SELECT * FROM events')
    expect(summary).toMatchObject({ inserted: 0, updated: 1, flagged: 0 })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: before?.id, title_ja: 'Live A (renamed)', first_seen_at: T0.toISOString(), updated_at: T1.toISOString() })
  })

  // Contract: 開演時刻が片方で空なら、ヘッドライナーが同じ場合だけ同一（時刻は新しい値で埋まる）
  it('規則 2: start が空の既存は、同じヘッドライナーの公演で更新される', async () => {
    await store([ev({ start_text: null, title_ja: 'Live A' })])
    const summary = await store([ev({ start_text: '19:00', title_ja: 'Live A ～詳細～' })], T1)
    const rows = await all<{ start_text: string; start_at: string }>('SELECT start_text, start_at FROM events')
    expect(summary).toMatchObject({ inserted: 0, updated: 1 })
    expect(rows).toEqual([{ start_text: '19:00', start_at: '2026-12-01T10:00:00.000Z' }])
  })

  // Contract: 別の公演に潰さない。同じ日・start が違えば両方残り、既存がある状態で当たらなかった側に needs_review が付く
  it('規則 3: 当たらない公演は別公演として入れ、既存があった日だけ needs_review にする', async () => {
    await store([ev()])
    const summary = await store([ev({ title_ja: 'Live B', start_text: '21:00', artists: [{ name: 'Band B' }] })], T1)
    const rows = await all<{ title_ja: string; needs_review: number }>('SELECT title_ja, needs_review FROM events ORDER BY title_ja')
    expect(summary).toMatchObject({ inserted: 1, flagged: 1 })
    expect(rows).toEqual([
      { title_ja: 'Live A', needs_review: 0 },
      { title_ja: 'Live B', needs_review: 1 }
    ])
  })

  // Contract: 既存が無い日は普通に入れる。同じページに並ぶ兄弟カード（昼夜 2 部）は互いを理由に flag しない
  it('同じ実行で入れる同日の別公演は、どちらも needs_review にならない', async () => {
    const summary = await store([
      ev({ title_ja: '昼の部', start_text: '13:45', artists: [{ name: 'Band A' }] }),
      ev({ title_ja: '夜の部', start_text: '18:15', artists: [{ name: 'Band A' }] })
    ])
    expect(summary).toMatchObject({ inserted: 2, flagged: 0 })
    // 再実行（変化後の再抽出）でも昼夜は互いに横取りせず、それぞれ自分に当たる
    const again = await store([
      ev({ title_ja: '夜の部', start_text: '18:15', artists: [{ name: 'Band A' }] }),
      ev({ title_ja: '昼の部', start_text: '13:45', artists: [{ name: 'Band A' }] })
    ], T1)
    expect(again).toMatchObject({ inserted: 0, updated: 0, unchanged: 2 })
    expect(await all('SELECT id FROM events')).toHaveLength(2)
  })

  // Contract: start が空で出演者もいない同日の別カードは潰れない（ヘッドライナーを比べられないので別公演）
  it('start も出演者も無い 2 カードは別公演のまま、再抽出でも増えない', async () => {
    const cards = [ev({ title_ja: 'X', start_text: null, artists: [] }), ev({ title_ja: 'Y', start_text: null, artists: [] })]
    await store(cards)
    const again = await store(cards, T1)
    expect(await all('SELECT id FROM events')).toHaveLength(2)
    expect(again).toMatchObject({ inserted: 0, unchanged: 2 })
  })

  // Contract: ページ内の完全に同じカード（id が同じ）は 1 件にまとめ、duplicates に数える
  it('同じカードが 2 回載っていても 1 公演・観測 1 件', async () => {
    const summary = await store([ev(), ev()])
    expect(summary).toMatchObject({ inserted: 1, duplicates: 1 })
    expect(await all('SELECT id FROM observations')).toHaveLength(1)
  })
})

describe('Contract: 出演者の名寄せと関連の更新', () => {
  // Contract: 全角・大文字小文字・空白の揺れは同じ出演者（artists は 1 行）
  it('表記ゆれ（NFKC・大小・空白）は同じ artist に解決する', async () => {
    await store([ev({ artists: [{ name: 'Ｂａｎｄ　Ａ' }] }), ev({ title_ja: 'B', start_text: '21:00', artists: [{ name: ' band a ' }] })])
    const artists = await all<{ id: string; name_en: string | null }>('SELECT id, name_en FROM artists')
    expect(artists).toHaveLength(1)
    expect(artists[0]?.id).toMatch(/^artist_[0-9a-f]{12}$/)
  })

  // Contract: 既存の artist が正規化した名前で見つかれば、新しく作らずそれを使う
  it('既存の artists（別 id・別の大小）を再利用する', async () => {
    await db.exec("INSERT INTO artists (id, name_ja, name_en) VALUES ('artist_manual', NULL, 'BAND A')")
    await store([ev()])
    expect(await all('SELECT id FROM artists')).toEqual([{ id: 'artist_manual' }])
    expect(await all('SELECT artist_id FROM event_artists')).toEqual([{ artist_id: 'artist_manual' }])
  })

  // Contract: 先頭がヘッドライナー、以降はサポート。日本語表記は name_ja、それ以外は name_en
  it('役割は並び順で決まり、名前の言語で列を振り分ける', async () => {
    await store([ev({ artists: [{ name: 'Band A' }, { name: 'ばんどB' }] })])
    const rows = await all<{ role: string; billing_order: number; name_ja: string | null; name_en: string | null }>(
      'SELECT ea.role, ea.billing_order, a.name_ja, a.name_en FROM event_artists ea JOIN artists a ON a.id = ea.artist_id ORDER BY ea.billing_order'
    )
    expect(rows).toEqual([
      { role: 'headliner', billing_order: 0, name_ja: null, name_en: 'Band A' },
      { role: 'support', billing_order: 1, name_ja: 'ばんどB', name_en: null }
    ])
  })

  // Contract: 出演者が変わったときだけ event_artists を入れ替える
  it('出演者リストが変わると置き換わる', async () => {
    await store([ev({ artists: [{ name: 'Band A' }, { name: 'Band C' }] })])
    await store([ev({ artists: [{ name: 'Band A' }, { name: 'Band D' }] })], T1)
    const names = await all<{ name_en: string }>('SELECT a.name_en FROM event_artists ea JOIN artists a ON a.id = ea.artist_id ORDER BY ea.billing_order')
    expect(names).toEqual([{ name_en: 'Band A' }, { name_en: 'Band D' }])
  })
})

describe('Contract: 書き込みの形', () => {
  // Contract: id・fingerprint・時刻・観測の形（後続の T10 や MCP が前提にする）
  it('id は evt_ + 16 桁、fingerprint は 64 桁、観測は公演ごとに 1 件で抽出 JSON を持つ', async () => {
    const event = ev()
    await store([event])
    const [row] = await all<Record<string, unknown>>('SELECT * FROM events')
    expect(row?.['id']).toMatch(/^evt_[0-9a-f]{16}$/)
    expect(row?.['fingerprint']).toMatch(/^[0-9a-f]{64}$/)
    expect(row).toMatchObject({ venue_id: VENUE, source_url: 'https://example.com/a', first_seen_at: T0.toISOString(), last_verified_at: T0.toISOString(), start_at: '2026-12-01T10:00:00.000Z' })
    const [obs] = await all<{ event_id: string; raw_r2_key: string; extracted_json: string; confidence: number | null }>('SELECT * FROM observations')
    expect(obs).toMatchObject({ event_id: row?.['id'], raw_r2_key: 'raw/k.html', confidence: null })
    expect(JSON.parse(obs?.extracted_json ?? 'null')).toEqual(event)
  })

  // Contract: 24:30 のような深夜開演は興行日基準のまま start_text に残り、start_at は翌日の UTC になる
  it('24:30 開演は start_text のまま、start_at は翌 0:30 JST の UTC', async () => {
    await store([ev({ start_text: '24:30' })])
    expect(await all('SELECT start_text, start_at FROM events')).toEqual([{ start_text: '24:30', start_at: '2026-12-01T15:30:00.000Z' }])
  })

  // Contract: 中身が同じなら updated_at は動かさず、last_verified_at だけ進める（観測は残す）
  it('変化なしの再保存は last_verified_at だけ更新する', async () => {
    await store([ev()])
    const summary = await store([ev()], T1)
    expect(summary).toMatchObject({ updated: 0, unchanged: 1 })
    expect(await all('SELECT updated_at, last_verified_at FROM events')).toEqual([{ updated_at: T0.toISOString(), last_verified_at: T1.toISOString() }])
    expect(await all('SELECT id FROM observations')).toHaveLength(2)
  })

  // Contract: 状態（status）は新しい値で上書きされ、needs_review は一度立つと更新では下りない
  it('status は上書き、needs_review は sticky', async () => {
    await store([ev()], T0, true)
    await store([ev({ status: 'sold_out' })], T1, false)
    expect(await all('SELECT status, needs_review FROM events')).toEqual([{ status: 'sold_out', needs_review: 1 }])
  })

  // Contract: 空のリストは何も書かない
  it('events が空なら何もしない', async () => {
    expect(await store([])).toEqual({ inserted: 0, updated: 0, unchanged: 0, flagged: 0, duplicates: 0 })
    expect(await all('SELECT id FROM events')).toEqual([])
  })
})
