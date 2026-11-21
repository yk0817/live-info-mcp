// TODO(Ken): 掲載停止の申し出窓口を用意し、本物の連絡先 URL を CRAWLER_CONTACT_URL に設定する。
// 個人情報は埋め込まない。未設定の間はプレースホルダーで動く。
export const DEFAULT_CONTACT_URL = 'https://example.com/crawler'

export const PRODUCT_TOKEN = 'live-info-mcp-crawler'

export function buildUserAgent(contactUrl: string | undefined): string {
  const url = contactUrl && contactUrl.trim() !== '' ? contactUrl.trim() : DEFAULT_CONTACT_URL
  return `${PRODUCT_TOKEN}/0.1 (+${url})`
}
