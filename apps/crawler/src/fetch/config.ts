// TODO(Ken): 掲載停止の申し出窓口を用意し、本物の連絡先 URL を CRAWLER_CONTACT_URL に設定する。
// 毎日の自動実行を始める前に必須。個人情報は埋め込まない。
// 未設定の間は連絡先を付けない。他人のドメイン（example.com など）を連絡先に見せかけないため。

export const PRODUCT_TOKEN = 'live-info-mcp-crawler'

export function buildUserAgent(contactUrl: string | undefined): string {
  const url = contactUrl?.trim() ?? ''
  return url === '' ? `${PRODUCT_TOKEN}/0.1` : `${PRODUCT_TOKEN}/0.1 (+${url})`
}
