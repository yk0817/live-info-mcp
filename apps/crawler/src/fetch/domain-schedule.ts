export const MIN_INTERVAL_MS = 5000

export interface GateState {
  // 次にこのドメインへ送ってよい時刻（epoch ms）。null は未使用
  nextAllowedAt: number | null
}

export const INITIAL_GATE_STATE: GateState = { nextAllowedAt: null }

// 予約するたびに枠を 1 つ進めるので、同時に来た要求は 5 秒ずつずれて直列になる。
export function reserveSlot(
  state: GateState,
  nowMs: number,
  crawlDelaySec: number | null = null
): { waitMs: number; next: GateState } {
  const intervalMs = Math.max(MIN_INTERVAL_MS, (crawlDelaySec ?? 0) * 1000)
  const slot = Math.max(nowMs, state.nextAllowedAt ?? nowMs)
  return { waitMs: slot - nowMs, next: { nextAllowedAt: slot + intervalMs } }
}
