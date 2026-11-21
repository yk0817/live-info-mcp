import { z } from 'zod'

export const CRAWL_INTERVAL_HOURS = 20

// Queue のメッセージ本文。消費側で必ず Zod に通す
export const crawlJobSchema = z.object({
  source_id: z.string().min(1),
  attempt: z.number().int().min(0).default(0)
})
export type CrawlJob = z.infer<typeof crawlJobSchema>

// 今回回す source。robots で許可され、設定があり、直近 20 時間に実行（started_at）が無いもの。
// force は間隔を無視する（ローカル実行用）。started_at は toISOString の UTC なので文字列比較でよい。
export async function selectDueSources(db: D1Database, now: Date, force: boolean): Promise<string[]> {
  const since = new Date(now.getTime() - CRAWL_INTERVAL_HOURS * 3_600_000).toISOString()
  const base = 'SELECT s.id FROM sources s WHERE s.robots_ok = 1 AND s.config_json IS NOT NULL'
  const recent = 'AND NOT EXISTS (SELECT 1 FROM crawl_runs c WHERE c.source_id = s.id AND c.started_at > ?)'
  const stmt = force ? db.prepare(`${base} ORDER BY s.id`) : db.prepare(`${base} ${recent} ORDER BY s.id`).bind(since)
  const { results } = await stmt.all<{ id: string }>()
  return results.map((r) => r.id)
}
