import { jstDateOf } from '@live-info/schema'

// R2Bucket のうち使う部分だけ。テストでは in-memory の偽物を渡す。
export interface RawBucket {
  head(key: string): Promise<unknown | null>
  put(key: string, value: string, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>
}

export interface RawHtmlInput {
  sourceId: string
  fetchedAt: Date
  hash: string
  html: string
}

export function rawHtmlKey(input: Pick<RawHtmlInput, 'sourceId' | 'fetchedAt' | 'hash'>): string {
  return `raw/${input.sourceId}/${jstDateOf(input.fetchedAt)}/${input.hash}.html`
}

// 同じ source・日・ハッシュなら 2 回目は書かない（冪等）。30 日での削除は R2 のライフサイクルルールが担う。
export async function saveRawHtml(bucket: RawBucket, input: RawHtmlInput): Promise<string> {
  const key = rawHtmlKey(input)
  if ((await bucket.head(key)) === null) {
    await bucket.put(key, input.html, { httpMetadata: { contentType: 'text/html' } })
  }
  return key
}
