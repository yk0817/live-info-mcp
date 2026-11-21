import { parse, type HTMLElement } from 'node-html-parser'
import type { Condition, ValueSource } from './config'

export interface Scope {
  page: HTMLElement
  item: HTMLElement
  sourceUrl: string
}

export const re = (source: string): RegExp => new RegExp(source, 'u')

export const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim()

// <br> を改行として残した text。node-html-parser の text は <br> を無視して語がくっつくため。
export function textWithBreaks(el: HTMLElement): string {
  return parse(el.innerHTML.replace(/<br\s*\/?>/gi, '\n')).text
}

// source の解決順: 基準ノード → label → selector → attr/text。取れなければ null。空文字も null。
export function resolveValue(source: ValueSource, scope: Scope): string | null {
  if (source.from === 'url') return scope.sourceUrl
  let node: HTMLElement | null =
    source.from === 'page' ? scope.page : source.from === 'prev-sibling' ? scope.item.previousElementSibling : scope.item
  if (node && source.label) {
    const pattern = re(source.label.pattern)
    const labelEl = node.querySelectorAll(source.label.selector).find((el) => pattern.test(collapse(el.text)))
    node = labelEl?.nextElementSibling ?? null
  }
  if (node && source.selector) node = node.querySelector(source.selector)
  if (!node) return null
  const value = source.attr ? node.getAttribute(source.attr) : collapse(node.text)
  const trimmed = value?.trim() ?? ''
  return trimmed === '' ? null : trimmed
}

export function matchesCondition(cond: Condition, item: HTMLElement): boolean {
  if (cond.has !== undefined && item.querySelector(cond.has) === null) return false
  if (cond.text_matches !== undefined) {
    const target = cond.in === undefined ? item : item.querySelector(cond.in)
    if (!target || !re(cond.text_matches).test(collapse(target.text))) return false
  }
  return true
}

// 設定やページ由来の URL 文字列を http(s) の絶対 URL に直す。直せなければ null。
//   - 文中に http(s):// があればそこから（"URL:https://..." のような前置きを許す）
//   - mailto: などのスキームは捨てる
//   - スキームなしのホスト名（"t-dv.com/abc"）は https を補う
//   - "/" "./" "?" "#" で始まる相対 URL は base で解決する
export function normalizeUrl(raw: string, base: string): string | null {
  const t = raw.trim()
  if (t === '') return null
  // 表示用に省略されたリンク文字（"example.com/a…"）は壊れた URL なので捨てる
  if (/(…|\.\.\.)$/.test(t)) return null
  const embedded = /https?:\/\/[^\s"'<>]+/i.exec(t)
  const candidate = embedded
    ? embedded[0]
    : /^[a-z][a-z0-9+.-]*:/i.test(t)
      ? null
      : /^[\w-]+(\.[\w-]+)+(\/|$)/.test(t)
        ? `https://${t}`
        : /^(\/|\.\/|\.\.\/|\?|#)/.test(t)
          ? t
          : null
  if (candidate === null) return null
  try {
    const url = new URL(candidate, base)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}
