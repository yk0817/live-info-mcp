import { McpServer } from '@modelcontextprotocol/server'
import { venueIdSchema } from '@live-info/schema'
import { z } from 'zod'

// Stateless: a fresh server per request (createMcpHandler takes this factory).
export function createServer(): McpServer {
  const server = new McpServer({ name: 'live-info-mcp', version: '0.0.1' })

  // Placeholder tool; the real 7 tools arrive in T11.
  server.registerTool(
    'ping',
    {
      description: 'Health check. Echoes the message back.',
      inputSchema: z.object({
        message: z.string().default('pong'),
        venue_id: venueIdSchema.optional()
      })
    },
    async ({ message }) => ({
      content: [{ type: 'text', text: message }]
    })
  )

  return server
}
