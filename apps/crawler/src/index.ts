import type { DomainGate } from './fetch/domain-gate'
import { buildUserAgent, durableObjectGate, WorkersRobotsCache } from './fetch'
import { consumeMessages, selectDueSources, type CrawlJob, type RunDeps } from './pipeline'

// wrangler が DO クラスをエントリから見つけられるよう再エクスポートする
export { DomainGate } from './fetch/domain-gate'

export interface Env {
  DB: D1Database
  RAW_HTML: R2Bucket
  CRAWL_QUEUE: Queue<CrawlJob>
  AI: Ai
  DOMAIN_GATE: DurableObjectNamespace<DomainGate>
  // User-Agent に載せる掲載停止窓口の URL。未設定なら連絡先を付けない
  CRAWLER_CONTACT_URL?: string
  // '1' なら 20 時間の実行間隔を無視して全 source を回す（ローカル実行用）
  CRAWL_FORCE?: string
}

function buildDeps(env: Env): RunDeps {
  return {
    db: env.DB,
    bucket: env.RAW_HTML,
    now: () => new Date(),
    fetch: {
      // グローバル fetch を直接渡すと Workers では Illegal invocation になるので包む
      fetch: (input, init) => fetch(input, init),
      gate: durableObjectGate(env.DOMAIN_GATE),
      robotsCache: new WorkersRobotsCache(caches.default),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      now: () => Date.now(),
      userAgent: buildUserAgent(env.CRAWLER_CONTACT_URL)
    }
  }
}

export default {
  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    const ids = await selectDueSources(env.DB, new Date(controller.scheduledTime), env.CRAWL_FORCE === '1')
    if (ids.length === 0) return
    await env.CRAWL_QUEUE.sendBatch(ids.map((id) => ({ body: { source_id: id, attempt: 0 } })))
    console.log(`[crawler] enqueued ${ids.length} sources`)
  },

  async queue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
    await consumeMessages(buildDeps(env), batch.messages, (line) => console.log(line))
  }
} satisfies ExportedHandler<Env, unknown>
