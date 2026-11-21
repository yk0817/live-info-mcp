// repo の素の行を、呼ぶ側 LLM 向けの小さな JSON に整える。ここでデータを足したり推定したりしない。
import { formatShowTime } from '@live-info/schema'
import type { EventRow, VenueRow } from './repo'

export type Lang = 'ja' | 'en'

// 英語モードは name_en を主にして name_ja を併記する。無ければ日本語だけ。
function pickName(lang: Lang, ja: string | null, en: string | null): { name: string; name_ja?: string } {
  if (lang === 'en' && en) return ja && ja !== en ? { name: en, name_ja: ja } : { name: en }
  return { name: ja ?? en ?? '' }
}

// 元表記（24:30 など）を優先。無いときだけ start_at から興行日基準に戻す（変換であって推定ではない）。
function startText(e: EventRow): string | null {
  if (e.start_text) return e.start_text
  return e.start_at ? formatShowTime(e.start_at, e.date) : null
}

export function presentEventSummary(e: EventRow, lang: Lang) {
  const title = pickName(lang, e.title_ja, e.title_en)
  return {
    id: e.id,
    date: e.date,
    start_text: startText(e),
    venue: { id: e.venue.id, ...pickName(lang, e.venue.name_ja, e.venue.name_en) },
    title: title.name,
    ...(title.name_ja !== undefined ? { title_ja: title.name_ja } : {}),
    artists: e.artists.map((a) => ({ id: a.id, ...pickName(lang, a.name_ja, a.name_en), role: a.role })),
    status: e.status,
    ticket_url: e.ticket_url,
    source_url: e.source_url,
    last_verified_at: e.last_verified_at,
    needs_review: e.needs_review
  }
}

export function presentEventDetail(e: EventRow, lang: Lang) {
  return {
    ...presentEventSummary(e, lang),
    open_time: e.open_time,
    price_text: e.price_text,
    price_min_jpy: e.price_min_jpy
  }
}

export type EventSummary = ReturnType<typeof presentEventSummary>

export function presentVenue(v: VenueRow) {
  return {
    id: v.id,
    name_ja: v.name_ja,
    name_en: v.name_en,
    venue_kind: v.venue_kind,
    city: v.city,
    official_url: v.official_url,
    capacity: v.capacity,
    nearest_station: v.nearest_station
  }
}

export function eventLine(e: EventSummary): string {
  const artists = e.artists.map((a) => a.name).join(', ')
  const flags = [e.status, e.needs_review ? 'needs_review' : null].filter(Boolean).join(', ')
  return [`${e.date} ${e.start_text ?? '--:--'}`, e.venue.name, e.title, artists, flags ? `[${flags}]` : '']
    .filter((s) => s !== '')
    .join(' | ')
}
