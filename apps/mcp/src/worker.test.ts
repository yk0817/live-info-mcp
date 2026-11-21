import { describe, expect, it } from 'vitest'
import worker, { type Env } from './index'
import { ctx, readRpc, rpcRequest, seededDb } from './test-helpers'

const TOKEN = 'test-token-aaaa'
const OTHER = 'test-token-bbbb'

const initialize = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } }
}

async function envWith(tokens: string | undefined): Promise<Env> {
  const db = await seededDb()
  return tokens === undefined ? { DB: db } : { DB: db, MCP_TOKENS: tokens }
}

const auth = (token: string): Record<string, string> => ({ authorization: `Bearer ${token}` })

describe('auth', () => {
  // Contract: no / wrong / malformed credentials are 401; any listed token passes.
  it('answers 401 for a missing or wrong token and 200 for any listed token', async () => {
    const env = await envWith(` ${TOKEN} , ${OTHER} `)
    const missing = await worker.fetch(rpcRequest(initialize), env, ctx)
    expect(missing.status).toBe(401)
    expect(missing.headers.get('www-authenticate')).toBe('Bearer')
    expect((await worker.fetch(rpcRequest(initialize, auth('wrong')), env, ctx)).status).toBe(401)
    expect((await worker.fetch(rpcRequest(initialize, { authorization: TOKEN }), env, ctx)).status).toBe(401)
    expect((await worker.fetch(rpcRequest(initialize, auth(TOKEN)), env, ctx)).status).toBe(200)
    expect((await worker.fetch(rpcRequest(initialize, auth(OTHER)), env, ctx)).status).toBe(200)
  })

  // Contract: MCP_TOKENS unset or empty fails closed with 503, even when a token is presented.
  it('fails closed with 503 when MCP_TOKENS is unset, empty or only commas', async () => {
    for (const tokens of [undefined, '', ' , ,']) {
      const env = await envWith(tokens)
      expect((await worker.fetch(rpcRequest(initialize), env, ctx)).status).toBe(503)
      expect((await worker.fetch(rpcRequest(initialize, auth(TOKEN)), env, ctx)).status).toBe(503)
      expect((await worker.fetch(rpcRequest(initialize, auth('')), env, ctx)).status).toBe(503)
    }
  })
})

describe('full MCP path through Worker fetch', () => {
  // Contract: initialize -> tools/list -> tools/call search_events works end to end with a Bearer token.
  it('initializes, lists the tools and searches events', async () => {
    const env = await envWith(TOKEN)
    const call = async (body: unknown): Promise<Record<string, unknown>> => {
      const res = await worker.fetch(rpcRequest(body, auth(TOKEN)), env, ctx)
      expect(res.status).toBe(200)
      return readRpc(res)
    }

    const init = await call(initialize)
    expect(JSON.stringify(init)).toContain('live-info-mcp')

    const list = await call({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
    const tools = (list.result as { tools: { name: string }[] }).tools.map((t) => t.name).sort()
    expect(tools).toEqual(['get_event', 'ping', 'search_events', 'search_venues'])

    const result = (
      await call({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'search_events', arguments: { keyword: '深夜', date_from: '2026-11-01', date_to: '2026-11-30' } }
      })
    ).result as { isError?: boolean; structuredContent: { count: number; events: { id: string; start_text: string }[] } }
    expect(result.isError).toBeFalsy()
    expect(result.structuredContent.count).toBe(1)
    expect(result.structuredContent.events[0]).toMatchObject({ id: 'e-late', start_text: '24:30' })
  })
})
