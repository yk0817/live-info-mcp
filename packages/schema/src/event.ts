import { z } from 'zod'
import { isoDateSchema, utcDatetimeSchema } from './common'

export const eventStatusSchema = z.enum(['upcoming', 'on_sale', 'sold_out', 'cancelled'])
export type EventStatus = z.infer<typeof eventStatusSchema>

export const artistRoleSchema = z.enum(['headliner', 'support', 'guest'])
export type ArtistRole = z.infer<typeof artistRoleSchema>

// date は公式ページに書かれた興行日のまま（24:30 開演でも同じ日付）。start_at は UTC。
export const eventSchema = z.object({
  id: z.string().min(1),
  venue_id: z.string().min(1),
  date: isoDateSchema,
  open_time: z.string().nullable(),
  start_at: utcDatetimeSchema.nullable(),
  start_text: z.string().nullable(),
  title_ja: z.string().min(1),
  title_en: z.string().nullable(),
  price_text: z.string().nullable(),
  price_min_jpy: z.number().int().nonnegative().nullable(),
  status: eventStatusSchema.nullable(),
  ticket_url: z.url().nullable(),
  first_seen_at: utcDatetimeSchema,
  updated_at: utcDatetimeSchema,
  fingerprint: z.string().nullable(),
  needs_review: z.boolean(),
  source_url: z.url(),
  last_verified_at: utcDatetimeSchema
})
export type Event = z.infer<typeof eventSchema>

export const eventArtistSchema = z.object({
  event_id: z.string().min(1),
  artist_id: z.string().min(1),
  role: artistRoleSchema,
  billing_order: z.number().int().nonnegative().nullable()
})
export type EventArtist = z.infer<typeof eventArtistSchema>
