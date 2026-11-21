import { createMcpHandler } from 'agents/mcp/server'
import { authorize } from './auth'
import { createServer } from './server'

export interface Env {
  DB: D1Database
  // Comma-separated Bearer tokens (secret). Unset or empty => 503, never anonymous.
  MCP_TOKENS?: string
}

// Do not export the handler itself as default; wrap it in a fetch method.
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const denied = await authorize(request, env)
    if (denied) return denied
    return createMcpHandler(() => createServer({ db: env.DB, clock: () => new Date() }))(request, env, ctx)
  }
} satisfies ExportedHandler<Env>
