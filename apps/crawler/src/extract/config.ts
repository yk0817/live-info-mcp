import { parse } from 'node-html-parser'
import { z } from 'zod'
import { eventStatusSchema } from '@live-info/schema'

function isValidRegex(source: string): boolean {
  try {
    new RegExp(source, 'u')
    return true
  } catch {
    return false
  }
}

function isValidSelector(selector: string): boolean {
  try {
    parse('<div></div>').querySelector(selector)
    return true
  } catch {
    return false
  }
}

// 正規表現は文字列で持つ（設定は JSON の純データ）。フラグは常に 'u' 固定。
const regexString = z.string().min(1).refine(isValidRegex, { message: 'invalid regular expression' })
const selectorString = z.string().min(1).refine(isValidSelector, { message: 'invalid CSS selector' })

// 値の取り出し元。解決順は「基準ノード → label → selector → attr（なければ text）」。
//   from: 基準ノード。item=1 公演の要素（既定）/ page=文書全体 / prev-sibling=item の直前の兄弟要素 / url=取得 URL そのもの
//   label: item 内で selector に合致し text が pattern に合う要素を探し、その「次の兄弟要素」を基準にする（duo の dt → dd）
//   selector: 基準ノード内の最初の一致要素
//   attr: 指定すれば属性値、なければ text（空白は 1 つに畳む）
export const valueSourceSchema = z.strictObject({
  from: z.enum(['item', 'page', 'prev-sibling', 'url']).optional(),
  label: z.strictObject({ selector: selectorString, pattern: regexString }).optional(),
  selector: selectorString.optional(),
  attr: z.string().min(1).optional()
})
export type ValueSource = z.infer<typeof valueSourceSchema>

// 条件。has=item 内にその要素がある / text_matches=text が正規表現に合う（in を指定すればその要素の text）。両方書けば AND。
export const conditionSchema = z
  .strictObject({
    has: selectorString.optional(),
    text_matches: regexString.optional(),
    in: selectorString.optional()
  })
  .refine((c) => c.has !== undefined || c.text_matches !== undefined, { message: 'condition needs has or text_matches' })
export type Condition = z.infer<typeof conditionSchema>

// 日付。pattern の名前付きグループ: month, day（必須）と year または yy（下 2 桁。2000 年代）。
// 年が取れなければ year_source（ページ見出しや URL 由来）、それも無ければ now から推定する。
//   推定: 先頭の公演は now（JST）に最も近い年。以降は直前の公演と同じ年で、月が 6 か月超戻ったら翌年（12/31 → 01/01）。
const dateRuleSchema = z.strictObject({
  source: valueSourceSchema,
  pattern: regexString,
  year_source: z.strictObject({ source: valueSourceSchema, pattern: regexString }).optional()
})

// 時刻。patterns を上から試し、最初に合ったものを使う。名前付きグループ: open, start（どちらも任意）。
// `23:00-4:30` のような範囲は `(?<start>\d+:\d+)\s*-` のように start だけ拾えば終了側は無視できる。
const timesRuleSchema = z.strictObject({
  source: valueSourceSchema,
  patterns: z.array(regexString).min(1)
})

// タイトル。mode=first は空でない最初の source、join は空でないものを半角スペースで連結。
const titleRuleSchema = z.strictObject({
  sources: z.array(valueSourceSchema).min(1),
  mode: z.enum(['first', 'join'])
})

// 出演者。selector に合う要素を探し、split が無ければ 1 要素 = 1 組、あれば最初の要素の text（<br> は改行）を split で分割する。
//   strip: 各名前から取り除く正規表現（【ALLNIGHT】のような装飾）/ exclude: 名前全体が合えば捨てる（省略記号 `...`）
const artistsRuleSchema = z.strictObject({
  selector: selectorString,
  split: regexString.optional(),
  strip: z.array(regexString).optional(),
  exclude: z.array(regexString).optional()
})

// 状態。上から評価して最初に when が合ったものの value。どれも合わなければ null（不明）。
const statusRuleSchema = z.strictObject({ value: eventStatusSchema, when: conditionSchema })

// スキップ。when が合う item は公演ではない（メンテナンス等）として捨て、reason を記録する。
const skipRuleSchema = z.strictObject({ reason: z.string().min(1), when: conditionSchema })

export const venueExtractConfigSchema = z.strictObject({
  version: z.literal(1),
  // 今は DOM のみ。JSON-LD などが必要になった会場が出たら値を足す。
  strategy: z.literal('dom'),
  // 設計判断の記録（status を割り当てない理由など）。抽出には使わない。
  comment: z.string().optional(),
  // 月別ページの URL。{YYYY} 西暦 / {MM} 2 桁の月 / {M} 0 埋めなしの月。now の JST の年月で埋める。
  url_template: z.string().min(1).optional(),
  item: selectorString,
  skip: z.array(skipRuleSchema).optional(),
  fields: z.strictObject({
    date: dateRuleSchema,
    title: titleRuleSchema,
    artists: artistsRuleSchema.optional(),
    times: timesRuleSchema.optional(),
    price_text: valueSourceSchema.optional(),
    ticket_url: valueSourceSchema.optional(),
    // 公演の詳細ページ。ExtractedEvent.source_url になる（無ければ取得 URL）。
    detail_url: valueSourceSchema.optional(),
    status: z.array(statusRuleSchema).optional()
  })
})
export type VenueExtractConfig = z.infer<typeof venueExtractConfigSchema>
