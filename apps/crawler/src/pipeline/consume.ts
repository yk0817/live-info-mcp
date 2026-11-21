import { runSource, type RunDeps, type RunResult } from './run-source'
import { crawlJobSchema } from './schedule'

// Queues の delaySeconds の上限は 12 時間
const MAX_DELAY_SEC = 12 * 3600

// Queue のメッセージのうち使う部分だけ（テストでは偽物を渡す）
export interface QueueMessage {
  body: unknown
  attempts: number
  ack(): void
  retry(options?: { delaySeconds?: number }): void
}

export type Log = (line: string) => void

// 1 件ずつ直列に処理する（同一ドメインの 5 秒間隔を DomainGate と合わせて守るため）。
// 本文が不正なら捨てる（再投入しても直らない）。attempt は本文と配送回数の大きいほう（retry は本文を変えられない）。
export async function consumeMessages(deps: RunDeps, messages: readonly QueueMessage[], log: Log = () => {}): Promise<RunResult[]> {
  const results: RunResult[] = []
  for (const msg of messages) {
    const job = crawlJobSchema.safeParse(msg.body)
    if (!job.success) {
      log(`[crawler] dropped invalid queue message: ${job.error.issues.map((i) => i.path.join('.')).join(',')}`)
      msg.ack()
      continue
    }
    const attempt = Math.max(job.data.attempt, msg.attempts - 1)
    const result = await runSource(deps, job.data.source_id, attempt)
    results.push(result)
    log(`[crawler] ${job.data.source_id} ${JSON.stringify(result)}`)
    if (result.kind === 'retry') msg.retry({ delaySeconds: Math.min(MAX_DELAY_SEC, Math.max(1, result.afterSec)) })
    else msg.ack()
  }
  return results
}
