import { z } from 'zod'

export const venueIdSchema = z.string().min(1)
export type VenueId = z.infer<typeof venueIdSchema>

export const venueKindSchema = z.enum(['livehouse', 'club'])
export type VenueKind = z.infer<typeof venueKindSchema>

// 列名は D1 の venues と一致させる。aliases は D1 では JSON 文字列で、ここでは復号後の配列。
export const venueSchema = z.object({
  id: venueIdSchema,
  name_ja: z.string().min(1),
  name_en: z.string().nullable(),
  aliases: z.array(z.string()),
  prefecture: z.string().min(1),
  city: z.string().min(1).nullable(),
  lat: z.number().min(-90).max(90).nullable(),
  lng: z.number().min(-180).max(180).nullable(),
  // 不明は null。推定値は入れない。
  capacity: z.number().int().positive().nullable(),
  venue_kind: venueKindSchema,
  nearest_station: z.string().nullable(),
  official_url: z.url().nullable(),
  timezone: z.string().min(1)
})
export type Venue = z.infer<typeof venueSchema>
