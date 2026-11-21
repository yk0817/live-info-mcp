import { McpServer } from '@modelcontextprotocol/server'
import { registerTools, type ToolDeps } from './tools'

// Stateless: a fresh server per request (createMcpHandler takes this factory).
export function createServer(deps: ToolDeps): McpServer {
  const server = new McpServer({ name: 'live-info-mcp', version: '0.0.1' })
  registerTools(server, deps)
  return server
}
