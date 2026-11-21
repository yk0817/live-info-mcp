import { describe, expect, it, vi } from 'vitest'
import worker, { type CrawlJob, type Env } from './index'

describe('crawler stubs', () => {
  // Contract: the scheduled handler runs without touching bindings.
  it('scheduled logs and resolves', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await worker.scheduled({ cron: '0 * * * *', scheduledTime: 0 } as ScheduledController, {} as Env)
    expect(log).toHaveBeenCalledOnce()
    log.mockRestore()
  })

  // Contract: the queue consumer acks every message.
  it('queue acks each message', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const ack = vi.fn()
    const batch = { messages: [{ id: 'm1', body: { sourceId: 's1' } satisfies CrawlJob, ack }] } as unknown as MessageBatch<CrawlJob>
    await worker.queue(batch, {} as Env)
    expect(ack).toHaveBeenCalledOnce()
    log.mockRestore()
  })
})
