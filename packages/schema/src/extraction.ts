import { z } from 'zod'
import { isoDateSchema } from './common'
import { artistRoleSchema, eventStatusSchema } from './event'

export const extractedArtistSchema = z.object({
  name: z.string().min(1),
  role: artistRoleSchema.optional()
})
export type ExtractedArtist = z.infer<typeof extractedArtistSchema>

// クローラー（ルール・LLM）が 1 公演ごとに返す形。会場 ID は文脈（ソース）から決まるので持たない。
export const extractedEventSchema = z.object({
  title_ja: z.string().min(1),
  title_en: z.string().optional(),
  date: isoDateSchema,
  open_text: z.string().nullable(),
  start_text: z.string().nullable(),
  price_text: z.string().nullable(),
  price_min_jpy: z.number().int().nonnegative().nullable(),
  status: eventStatusSchema.nullable(),
  ticket_url: z.url().nullable(),
  source_url: z.url(),
  artists: z.array(extractedArtistSchema)
})
export type ExtractedEvent = z.infer<typeof extractedEventSchema>
