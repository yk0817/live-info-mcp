import type { DomainGate } from './domain-gate'
import { INITIAL_GATE_STATE, reserveSlot, type GateState } from './domain-schedule'

export interface GateClient {
  reserve(host: string, crawlDelaySec: number | null): Promise<{ waitMs: number }>
}

export function durableObjectGate(ns: DurableObjectNamespace<DomainGate>): GateClient {
  return {
    reserve: (host, crawlDelaySec) => ns.get(ns.idFromName(host)).reserve(crawlDelaySec)
  }
}

// テスト・ローカル用。DO と同じ reserveSlot を、注入した時計で動かす。
export function inMemoryGate(now: () => number): GateClient {
  const states = new Map<string, GateState>()
  return {
    async reserve(host, crawlDelaySec) {
      const { waitMs, next } = reserveSlot(states.get(host) ?? INITIAL_GATE_STATE, now(), crawlDelaySec)
      states.set(host, next)
      return { waitMs }
    }
  }
}
