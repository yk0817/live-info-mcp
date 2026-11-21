import { venueIdSchema } from '@live-info/schema'

export interface Env {
  DB: D1Database
  RAW_HTML: R2Bucket
  CRAWL_QUEUE: Queue<CrawlJob>
  AI: Ai
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
