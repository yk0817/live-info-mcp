import { DurableObject } from 'cloudflare:workers'
import { INITIAL_GATE_STATE, reserveSlot, type GateState } from './domain-schedule'

const STATE_KEY = 'gate'

// ドメインごとに 1 インスタンス。DO は要求を 1 つずつ処理するので、予約の競合は起きない。
export class DomainGate extends DurableObject {
  async reserve(crawlDelaySec: number | null = null): Promise<{ waitMs: number }> {
    const state = this.ctx.storage.kv.get<GateState>(STATE_KEY) ?? INITIAL_GATE_STATE
    const { waitMs, next } = reserveSlot(state, Date.now(), crawlDelaySec)
    this.ctx.storage.kv.put(STATE_KEY, next)
    return { waitMs }
  }
}
