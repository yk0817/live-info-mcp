import { z } from 'zod'

export const sourceKindSchema = z.enum(['venue', 'artist', 'promoter', 'feed'])
export type SourceKind = z.infer<typeof sourceKindSchema>

export const sourceParserSchema = z.enum(['rule', 'llm'])
export type SourceParser = z.infer<typeof sourceParserSchema>

// robots_ok と needs_review は D1 では 0/1。読み出し側で boolean に直してから渡す。
// config_json は会場別の設定 JSON（A）の文字列のまま。解釈は抽出側（T6）が行う。
export const sourceSchema = z.object({
  id: z.string().min(1),
  kind: sourceKindSchema,
  url: z.url(),
  parser: sourceParserSchema,
  config_json: z.string().nullable(),
  schedule_cron: z.string().nullable(),
  robots_ok: z.boolean(),
  needs_review: z.boolean(),
  last_status: z.number().int().nullable(),
  etag: z.string().nullable(),
  last_modified: z.string().nullable(),
  content_hash: z.string().nullable()
})
export type Source = z.infer<typeof sourceSchema>
