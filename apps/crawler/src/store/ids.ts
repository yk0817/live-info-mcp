import { contentHash } from '../change'
import { normalizeName } from './names'

export async function artistIdFor(normalizedName: string): Promise<string> {
  return `artist_${(await contentHash(normalizedName)).slice(0, 12)}`
}

// title_ja まで含めるので、同じ日の別カード（昼夜 2 部など）は衝突しない
export async function eventIdFor(venueId: string, date: string, startText: string | null, titleJa: string): Promise<string> {
  return `evt_${(await contentHash(`${venueId}|${date}|${startText ?? ''}|${titleJa}`)).slice(0, 16)}`
}

export async function fingerprintFor(venueId: string, date: string, startText: string | null, headliner: string | null): Promise<string> {
  return contentHash([venueId, date, normalizeName(startText ?? ''), normalizeName(headliner ?? '')].join('|'))
}
