import { NodeType, parse, type HTMLElement, type Node } from 'node-html-parser'

// 本文ではない、またはリクエストごとに変わる要素。ここは常に落とす。
const ALWAYS_REMOVED = ['script', 'style', 'noscript', 'iframe', 'svg', 'template', 'input[type="hidden"]', 'meta', 'link']
// 共通の枠（ヘッダー・フッター・ナビ）。広告やメニューの差し替えで変化と誤検知しないため。
const CHROME = ['header', 'footer', 'nav']

// 属性は許可リスト方式で残す。nonce・CSRF トークン・data-* のタイムスタンプ・
// CSS-in-JS が毎回変えるクラス名のような「リクエストごとに変わる属性」を個別に追いかけず、
// 公演情報の意味を持つもの（リンク先・日時・画像の代替文字）だけ残す。
const KEPT_ATTRIBUTES = new Set(['href', 'datetime', 'alt', 'title'])

export interface NormalizeOptions {
  // 会場ごとに足す CSS セレクタ（例: ".ad", "#visitor-counter"）
  ignoreSelectors?: readonly string[]
}

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function serialize(node: Node): string {
  if (node.nodeType === NodeType.TEXT_NODE) {
    return collapse(node.text)
  }
  if (node.nodeType !== NodeType.ELEMENT_NODE) return ''
  const el = node as HTMLElement
  const tag = el.rawTagName?.toLowerCase()
  const inner = el.childNodes
    .map(serialize)
    .filter((s) => s !== '')
    .join(' ')
  if (!tag) return inner // ルート
  const attrs = Object.entries(el.attributes)
    .filter(([name]) => KEPT_ATTRIBUTES.has(name.toLowerCase()))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, value]) => ` ${name.toLowerCase()}="${collapse(value)}"`)
    .join('')
  return `<${tag}${attrs}>${inner}</${tag}>`
}

// 同じ「見た目の内容」なら同じ文字列になる決定的な正規化。HTML コメントは parse の既定（comment: false）で落ちる。
export function normalizeBody(html: string, options: NormalizeOptions = {}): string {
  const root = parse(html)
  const selectors = [...ALWAYS_REMOVED, ...CHROME, ...(options.ignoreSelectors ?? [])]
  for (const selector of selectors) {
    for (const el of root.querySelectorAll(selector)) el.remove()
  }
  const body = root.querySelector('body') ?? root
  return collapse(serialize(body))
}
