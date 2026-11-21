import { describe, expect, it, vi } from 'vitest'
import { createMigratedDb } from '../../../test-utils/d1'
import worker, { type Env } from './index'

const ctl = (scheduledTime: number): ScheduledController => ({ cron: '0 * * * *', scheduledTime, noRetry: () => {} }) as ScheduledController

async function envWith(force?: string): Promise<{ env: Env; sent: unknown[][] }> {
  const db = createMigratedDb()
  await db.exec(
    `INSERT INTO venues (id, name_ja, prefecture, venue_kind) VALUES ('v1', 'v', '東京都', 'livehouse');
     INSERT INTO sources (id, kind, url, parser, config_json, robots_ok) VALUES ('src_a', 'venue', 'https://a.example/', 'rule', '{}', 1);
     INSERT INTO sources (id, kind, url, parser, config_json, robots_ok) VALUES ('src_b', 'venue', 'https://b.example/', 'rule', NULL, 1);
     INSERT INTO crawl_runs (source_id, started_at) VALUES ('src_a', '2026-11-21T02:00:00.000Z');`
  )
  const sent: unknown[][] = []
  const env = {
    DB: db,
    CRAWL_QUEUE: { sendBatch: async (items: unknown[]) => void sent.push(items) },
    ...(force === undefined ? {} : { CRAWL_FORCE: force })
  } as unknown as Env
  return { env, sent }
}

describe('Contract: scheduled は期限の来た source を Queue に積む', () => {
  const at = Date.parse('2026-11-21T03:00:00Z')

  it('直近に実行済みの source は積まない（0 件なら sendBatch も呼ばない）', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { env, sent } = await envWith()
    await worker.scheduled(ctl(at), env)
    expect(sent).toEqual([])
    log.mockRestore()
  })

  it('CRAWL_FORCE=1 なら間隔を無視し、設定のある source だけを {source_id, attempt:0} で積む', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { env, sent } = await envWith('1')
    await worker.scheduled(ctl(at), env)
    expect(sent).toEqual([[{ body: { source_id: 'src_a', attempt: 0 } }]])
    log.mockRestore()
  })
})
