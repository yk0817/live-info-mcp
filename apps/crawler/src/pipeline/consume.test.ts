import { describe, expect, it, vi } from 'vitest'
import { consumeMessages, type QueueMessage } from './consume'
import { crawlJobSchema, selectDueSources } from './schedule'
import { harness, NOW, rows, sourceIdOf, VENUE_IDS } from './test-support'

const msg = (body: unknown, attempts = 1) => ({
  body,
  attempts,
  ack: vi.fn<() => void>(),
  retry: vi.fn<(options?: { delaySeconds?: number }) => void>()
}) satisfies QueueMessage

describe('Contract: Queue のメッセージ本文は Zod で検証する', () => {
  it('attempt は省略でき、既定は 0。source_id が無い・型違いは弾く', () => {
    expect(crawlJobSchema.parse({ source_id: 'src_x' })).toEqual({ source_id: 'src_x', attempt: 0 })
    expect(crawlJobSchema.safeParse({}).success).toBe(false)
    expect(crawlJobSchema.safeParse({ source_id: 'src_x', attempt: -1 }).success).toBe(false)
    expect(crawlJobSchema.safeParse({ source_id: 3 }).success).toBe(false)
  })

  // Contract: 不正な本文は実行せず ack で捨てる（再投入しても直らない）
  it('不正な本文は取得せずに ack する', async () => {
    const h = await harness()
    const bad = msg({ sourceId: 'src_venue-shibuya-duo' })
    await consumeMessages(h.deps, [bad])
    expect(bad.ack).toHaveBeenCalledOnce()
    expect(bad.retry).not.toHaveBeenCalled()
    expect(h.web.requests).toEqual([])
  })

  // Contract: 正常終了は ack、429 は retry(delaySeconds = Retry-After)。再配送回数が attempt に反映され、上限で諦めて ack
  it('retry はバックオフ秒つき、attempt が上限に達したら記録して ack', async () => {
    const h = await harness()
    h.web.overrides.set('venue-shibuya-duo', () => new Response('', { status: 429, headers: { 'retry-after': '120' } }))
    const first = msg({ source_id: sourceIdOf('venue-shibuya-duo'), attempt: 0 }, 1)
    await consumeMessages(h.deps, [first])
    expect(first.retry).toHaveBeenCalledWith({ delaySeconds: 120 })
    expect(first.ack).not.toHaveBeenCalled()

    const last = msg({ source_id: sourceIdOf('venue-shibuya-duo'), attempt: 0 }, 6)
    await consumeMessages(h.deps, [last])
    expect(last.ack).toHaveBeenCalledOnce()
    const runs = (await h.db.prepare('SELECT error FROM crawl_runs ORDER BY id').all<{ error: string }>()).results
    expect(runs.map((r) => r.error)).toEqual(['retry:rate_limited', 'retry_exhausted:rate_limited'])
  })

  it('正常な source は ack し、公演が入る', async () => {
    const h = await harness()
    const ok = msg({ source_id: sourceIdOf('venue-shibuya-womb'), attempt: 0 })
    await consumeMessages(h.deps, [ok])
    expect(ok.ack).toHaveBeenCalledOnce()
    expect((await h.db.prepare('SELECT COUNT(*) n FROM events').first<{ n: number }>())?.n).toBe(6)
  })
})

describe('Contract: selectDueSources は今回回す source を選ぶ', () => {
  const insertRun = (h: Awaited<ReturnType<typeof harness>>, sourceId: string, startedAt: string) =>
    h.db.prepare('INSERT INTO crawl_runs (source_id, started_at) VALUES (?, ?)').bind(sourceId, startedAt).run()
  // シードの全 source（会場を足しても期待値を書き換えずに済むよう、DB から取る）
  const allSourceIds = async (h: Awaited<ReturnType<typeof harness>>): Promise<string[]> =>
    (await rows<{ id: string }>(h.db, 'SELECT id FROM sources ORDER BY id')).map((r) => r.id)

  it('robots_ok=1 かつ設定あり。直近 20 時間に実行があれば除く', async () => {
    const h = await harness()
    const seeded = await allSourceIds(h)
    expect(seeded).toHaveLength(15)
    expect(seeded).toEqual(expect.arrayContaining([...VENUE_IDS].map(sourceIdOf)))
    expect(await selectDueSources(h.db, NOW, false)).toEqual(seeded)

    await insertRun(h, sourceIdOf('venue-shibuya-duo'), '2026-11-20T12:00:01.000Z') // 15 時間前 → 除く
    await insertRun(h, sourceIdOf('venue-shibuya-womb'), '2026-11-20T06:00:00.000Z') // 21h 前 → 対象
    await h.db.prepare("UPDATE sources SET robots_ok = 0 WHERE id = ?").bind(sourceIdOf('venue-shinjuku-loft')).run()
    await h.db.prepare("UPDATE sources SET config_json = NULL WHERE id = ?").bind(sourceIdOf('venue-daikanyama-unit')).run()
    const excluded = ['venue-shibuya-duo', 'venue-shinjuku-loft', 'venue-daikanyama-unit'].map((v) => `src_${v}`)
    expect(await selectDueSources(h.db, NOW, false)).toEqual(seeded.filter((id) => !excluded.includes(id)))
  })

  // Contract: force は実行間隔だけを無視する（robots 不許可・設定なしは force でも回さない）
  it('force は 20 時間の間隔を無視するが、robots_ok=0 は除く', async () => {
    const h = await harness()
    await insertRun(h, sourceIdOf('venue-shibuya-duo'), '2026-11-21T02:00:00.000Z')
    await h.db.prepare("UPDATE sources SET robots_ok = 0 WHERE id = ?").bind(sourceIdOf('venue-shinjuku-loft')).run()
    const forced = await selectDueSources(h.db, NOW, true)
    expect(forced).toContain(sourceIdOf('venue-shibuya-duo'))
    expect(forced).not.toContain(sourceIdOf('venue-shinjuku-loft'))
    expect(forced).toHaveLength((await allSourceIds(h)).length - 1)
  })
})
