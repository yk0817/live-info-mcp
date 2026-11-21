import { venueIdSchema } from '@live-info/schema'
import type { DomainGate } from './fetch/domain-gate'

// wrangler が DO クラスをエントリから見つけられるよう再エクスポートする
export { DomainGate } from './fetch/domain-gate'

export interface Env {
  DB: D1Database
  RAW_HTML: R2Bucket
  CRAWL_QUEUE: Queue<CrawlJob>
  AI: Ai
  DOMAIN_GATE: DurableObjectNamespace<DomainGate>
  // User-Agent に載せる掲載停止窓口の URL。未設定ならプレースホルダー
  CRAWLER_CONTACT_URL?: string
}

export interface CrawlJob {
  sourceId: string
}

// Stubs: scheduling arrives in T4, fetching in T4-T5.
export default {
  async scheduled(controller: ScheduledController, _env: Env): Promise<void> {
    console.log(`[crawler] scheduled tick cron=${controller.cron} at=${new Date(controller.scheduledTime).toISOString()}`)
  },

  async queue(batch: MessageBatch<CrawlJob>, _env: Env): Promise<void> {
    for (const message of batch.messages) {
      console.log(`[crawler] queue message id=${message.id} source=${venueIdSchema.parse(message.body.sourceId)}`)
      message.ack()
    }
  }
} satisfies ExportedHandler<Env, CrawlJob>
