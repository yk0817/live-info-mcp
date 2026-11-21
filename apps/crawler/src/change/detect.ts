import { normalizeBody } from './normalize'

export async function contentHash(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export interface DetectInput {
  previousHash: string | null
  html: string
  ignoreSelectors?: readonly string[]
}

export interface DetectResult {
  changed: boolean
  hash: string
  normalized: string
}

// 初回（previousHash なし）は changed: true。同じ本文なら抽出に進まない。
export async function detectChange(input: DetectInput): Promise<DetectResult> {
  const normalized = normalizeBody(input.html, { ignoreSelectors: input.ignoreSelectors ?? [] })
  const hash = await contentHash(normalized)
  return { changed: input.previousHash === null || input.previousHash !== hash, hash, normalized }
}
