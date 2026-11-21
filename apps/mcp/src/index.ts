import { createMcpHandler } from 'agents/mcp/server'
import { createServer } from './server'

export interface Env {
  DB: D1Database
}

// Do not export the handler itself as default; wrap it in a fetch method.
export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return createMcpHandler(createServer)(request, env, ctx)
  }
} satisfies ExportedHandler<Env>
