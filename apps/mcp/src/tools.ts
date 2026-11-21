import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import { resolveRange, type Clock } from './dates'
import { eventLine, presentEventDetail, presentEventSummary, presentVenue, type Lang } from './present'
import { DEFAULT_LIMIT, MAX_LIMIT, getEvent, searchEvents, searchVenues } from './repo'

export interface ToolDeps {
  db: D1Database
  clock: Clock
}

const lang = z.enum(['ja', 'en']).default('ja').describe('ja (default) or en. en shows English names first with Japanese alongside')
// 上限超えは拒否でなく丸める（呼ぶ側 LLM が 100 などを指定しても動くように）。
const limit = z
  .number()
  .int()
  .min(1)
  .default(DEFAULT_LIMIT)
  .describe(`Max results, default ${DEFAULT_LIMIT}, capped at ${MAX_LIMIT}`)

const artistOut = z.object({ id: z.string(), name: z.string(), name_ja: z.string().optional(), role: z.enum(['headliner', 'support', 'guest']) })
const eventSummaryOut = z.object({
  id: z.string(),
  date: z.string().describe('Show date YYYY-MM-DD (JST). Late-night shows keep the listed day'),
  start_text: z.string().nullable().describe("Start time as the venue wrote it, e.g. '24:30'; null when unknown"),
  venue: z.object({ id: z.string(), name: z.string(), name_ja: z.string().optional() }),
  title: z.string(),
  title_ja: z.string().optional(),
  artists: z.array(artistOut),
  status: z.enum(['upcoming', 'on_sale', 'sold_out', 'cancelled']).nullable(),
  ticket_url: z.string().nullable(),
  source_url: z.string(),
  last_verified_at: z.string(),
  needs_review: z.boolean().describe('true when extraction was uncertain; verify at source_url')
})
const eventDetailOut = eventSummaryOut.extend({
  open_time: z.string().nullable(),
  price_text: z.string().nullable(),
  price_min_jpy: z.number().int().nullable()
})
const venueOut = z.object({
  id: z.string(),
  name_ja: z.string(),
  name_en: z.string().nullable(),
  venue_kind: z.enum(['livehouse', 'club']),
  city: z.string().nullable(),
  official_url: z.string().nullable(),
  capacity: z.number().int().nullable().describe('null when not yet confirmed from official info'),
  nearest_station: z.string().nullable()
})

function errorResult(message: string) {
  return { isError: true as const, content: [{ type: 'text' as const, text: message }] }
}

export function registerTools(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'ping',
    {
      description: 'Health check. Echoes the message back.',
      inputSchema: z.object({ message: z.string().default('pong') })
    },
    async ({ message }) => ({ content: [{ type: 'text', text: message }] })
  )

  server.registerTool(
    'search_events',
    {
      description:
        'Search live music events at Tokyo venues, ordered by date and start time. ' +
        'keyword matches event titles and artist names. venue is a venue id or part of its name. ' +
        'Dates default to today through 30 days ahead (JST). Facts only; each event carries source_url and last_verified_at.',
      inputSchema: z.object({
        keyword: z.string().min(1).optional().describe('Part of an event title or artist name (ja or en)'),
        venue: z.string().min(1).optional().describe('Venue id, or part of the venue name (ja or en)'),
        date_from: z.string().optional().describe('YYYY-MM-DD, default today (JST)'),
        date_to: z.string().optional().describe('YYYY-MM-DD, default date_from + 30 days'),
        lang,
        limit
      }),
      outputSchema: z.object({
        date_from: z.string(),
        date_to: z.string(),
        count: z.number().int(),
        has_more: z.boolean(),
        events: z.array(eventSummaryOut)
      }),
      annotations: { readOnlyHint: true }
    },
    async (input) => {
      const range = resolveRange(input, deps.clock)
      if (!range.ok) return errorResult(range.error)
      const { events, has_more } = await searchEvents(deps.db, {
        keyword: input.keyword,
        venue: input.venue,
        date_from: range.from,
        date_to: range.to,
        limit: input.limit
      })
      const out = events.map((e) => presentEventSummary(e, input.lang))
      const header = `${out.length} event(s), ${range.from}..${range.to}${has_more ? ' (more available; narrow the query)' : ''}`
      return {
        content: [{ type: 'text', text: [header, ...out.map(eventLine)].join('\n') }],
        structuredContent: { date_from: range.from, date_to: range.to, count: out.length, has_more, events: out }
      }
    }
  )

  server.registerTool(
    'get_event',
    {
      description: 'Get one event by id with open time and price text, source_url and last_verified_at.',
      inputSchema: z.object({ event_id: z.string().min(1), lang }),
      outputSchema: z.object({ event: eventDetailOut }),
      annotations: { readOnlyHint: true }
    },
    async ({ event_id, lang: l }) => {
      const row = await getEvent(deps.db, event_id)
      if (!row) return errorResult(`event not found: ${event_id}`)
      const event = presentEventDetail(row, l as Lang)
      const lines = [eventLine(event), `open: ${event.open_time ?? 'unknown'}`, `price: ${event.price_text ?? 'unknown'}`, `source: ${event.source_url}`]
      return { content: [{ type: 'text', text: lines.join('\n') }], structuredContent: { event } }
    }
  )

  server.registerTool(
    'search_venues',
    {
      description: 'Search venues by part of the name (ja or en), optionally by kind. capacity is null when unknown.',
      inputSchema: z.object({
        name: z.string().min(1).optional().describe('Part of the venue name (ja or en)'),
        kind: z.enum(['livehouse', 'club']).optional(),
        limit
      }),
      outputSchema: z.object({ count: z.number().int(), venues: z.array(venueOut) }),
      annotations: { readOnlyHint: true }
    },
    async (input) => {
      const venues = (await searchVenues(deps.db, input)).map(presentVenue)
      const lines = venues.map(
        (v) => `${v.id} | ${v.name_ja}${v.name_en ? ` / ${v.name_en}` : ''} | ${v.venue_kind} | capacity ${v.capacity ?? 'unknown'}`
      )
      return {
        content: [{ type: 'text', text: [`${venues.length} venue(s)`, ...lines].join('\n') }],
        structuredContent: { count: venues.length, venues }
      }
    }
  )
}
