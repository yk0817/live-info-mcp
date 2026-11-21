import { z } from 'zod'

export const artistSchema = z.object({
  id: z.string().min(1),
  // DJ や海外アーティストは name_en しか無いことがある（D1 も nullable）
  name_ja: z.string().min(1).nullable(),
  name_en: z.string().nullable(),
  name_kana: z.string().nullable(),
  aliases: z.array(z.string()),
  country: z.string().nullable(),
  mbid: z.string().nullable(),
  official_url: z.url().nullable()
})
export type Artist = z.infer<typeof artistSchema>
