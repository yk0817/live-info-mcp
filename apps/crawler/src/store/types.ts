import type { ExtractedEvent } from '@live-info/schema'

export type Role = 'headliner' | 'support' | 'guest'

export interface ArtistLink {
  artistId: string
  role: Role
  order: number
}

// 検証を通り、書き込み対象になった公演。needsReview は検証の issue 由来。
export interface AcceptedEvent {
  event: ExtractedEvent
  needsReview: boolean
}

// ID・指紋まで計算済みの公演（書き込み計画の入力）
export interface PreparedEvent extends AcceptedEvent {
  id: string
  fingerprint: string
  startNorm: string
  startAt: string | null
  artists: readonly ArtistLink[]
}

export interface ExistingEvent {
  id: string
  date: string
  title_ja: string
  title_en: string | null
  open_time: string | null
  start_at: string | null
  start_text: string | null
  price_text: string | null
  price_min_jpy: number | null
  status: string | null
  ticket_url: string | null
  source_url: string
  fingerprint: string | null
  needs_review: number
  first_seen_at: string
  startNorm: string
  artists: readonly ArtistLink[]
}

export type WriteOp =
  | { kind: 'insert'; index: number; prepared: PreparedEvent; needsReview: boolean }
  | { kind: 'update'; index: number; prepared: PreparedEvent; existing: ExistingEvent; changed: boolean; artistsChanged: boolean; needsReview: boolean }
  | { kind: 'duplicate'; index: number }

export interface StoreSummary {
  inserted: number
  updated: number
  unchanged: number
  flagged: number
  duplicates: number
}
