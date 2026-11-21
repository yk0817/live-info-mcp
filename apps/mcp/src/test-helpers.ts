// テスト専用ヘルパー。本番コードからは import しない。
import { createMcpHandler } from 'agents/mcp/server'
import { createD1Shim, createMigratedDb } from '../../../test-utils/d1'
import { createServer } from './server'
import type { Clock } from './dates'

export { createD1Shim, createMigratedDb }

export const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext

// Host is required by the SDK's host validation; Node's Request does not add it.
export function rpcRequest(body: unknown, extraHeaders: Record<string, string> = {}): Request {
  return new Request('http://localhost/mcp', {
    method: 'POST',
    headers: { host: 'localhost', 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...extraHeaders },
    body: JSON.stringify(body)
  })
}

// 応答は JSON か SSE のどちらでも来うる。JSON-RPC の本体だけ取り出す。
export async function readRpc(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text()
  const data = text.startsWith('{') ? text : (text.split('\n').find((l) => l.startsWith('data:')) ?? '').slice(5)
  return JSON.parse(data) as Record<string, unknown>
}

export interface ToolResult {
  isError?: boolean
  content: { type: string; text: string }[]
  structuredContent?: Record<string, unknown>
}

export async function callTool(db: D1Database, clock: Clock, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  const res = await createMcpHandler(() => createServer({ db, clock }))(
    rpcRequest({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    {},
    ctx
  )
  const body = await readRpc(res)
  if (body.error) throw new Error(`rpc error: ${JSON.stringify(body.error)}`)
  return body.result as ToolResult
}

export const SEED_SQL = `
INSERT INTO venues (id, name_ja, name_en, prefecture, city, venue_kind, capacity, nearest_station) VALUES
  ('v-shelter', '下北沢SHELTER', NULL, '東京都', '世田谷区', 'livehouse', NULL, NULL),
  ('v-womb', '渋谷WOMB', 'WOMB', '東京都', '渋谷区', 'club', 1000, 'Shibuya');
INSERT INTO artists (id, name_ja, name_en) VALUES
  ('a-1', 'ミツメ', 'Mitsume'),
  ('a-2', NULL, 'DJ Foo'),
  ('a-3', '100%サンプル', NULL);
INSERT INTO events (id, venue_id, date, open_time, start_at, start_text, title_ja, title_en, price_text, price_min_jpy, status, ticket_url, first_seen_at, updated_at, needs_review, source_url, last_verified_at) VALUES
  ('e-late', 'v-womb', '2026-11-22', '23:00', '2026-11-23T00:30:00.000Z', '24:30', '深夜パーティー', 'Late Night Party', '3000円', 3000, 'on_sale', 'https://t.example/late', '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z', 1, 'https://womb.example/s', '2026-11-20T00:00:00.000Z'),
  ('e-today', 'v-shelter', '2026-11-21', '18:00', '2026-11-21T09:30:00.000Z', NULL, 'ミツメ 単独公演', NULL, NULL, NULL, 'upcoming', NULL, '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z', 0, 'https://shelter.example/s', '2026-11-20T00:00:00.000Z'),
  ('e-past', 'v-shelter', '2026-11-20', NULL, NULL, NULL, '昨日の公演', NULL, NULL, NULL, NULL, NULL, '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z', 0, 'https://shelter.example/s', '2026-11-20T00:00:00.000Z'),
  ('e-far', 'v-shelter', '2026-12-30', NULL, NULL, NULL, '年末', NULL, NULL, NULL, NULL, NULL, '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z', 0, 'https://shelter.example/s', '2026-11-20T00:00:00.000Z'),
  ('e-pct', 'v-shelter', '2026-11-25', NULL, NULL, NULL, '100%の夜_special', NULL, NULL, NULL, NULL, NULL, '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z', 0, 'https://shelter.example/s', '2026-11-20T00:00:00.000Z'),
  ('e-plain', 'v-shelter', '2026-11-26', NULL, NULL, NULL, '1000Xの夜', NULL, NULL, NULL, NULL, NULL, '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z', 0, 'https://shelter.example/s', '2026-11-20T00:00:00.000Z');
INSERT INTO event_artists (event_id, artist_id, role, billing_order) VALUES
  ('e-late', 'a-2', 'headliner', 1),
  ('e-late', 'a-1', 'guest', 2),
  ('e-today', 'a-1', 'headliner', 1),
  ('e-plain', 'a-3', 'support', 1);
`

export async function seededDb(): Promise<D1Database> {
  const db = createMigratedDb()
  await db.exec(SEED_SQL)
  return db
}
