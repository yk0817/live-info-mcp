import { describe, expect, it } from 'vitest'
import { createMcpHandler } from 'agents/mcp/server'
import { createServer } from './server'

const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext

async function rpc(body: unknown): Promise<Response> {
  const request = new Request('http://localhost/mcp', {
    method: 'POST',
    // Host is required by the SDK's host validation; Node's Request does not add it.
    headers: { host: 'localhost', 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify(body)
  })
  return createMcpHandler(createServer)(request, {}, ctx)
}

describe('mcp handler', () => {
  // Contract: POST /mcp answers a JSON-RPC initialize with the server name.
  it('responds to initialize', async () => {
    const res = await rpc({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } }
    })
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('live-info-mcp')
  })

  // Contract: the placeholder ping tool is listed.
  it('lists the ping tool', async () => {
    const res = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('"ping"')
  })
})
