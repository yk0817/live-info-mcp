import { parse, type HTMLElement } from 'node-html-parser'
import {
  extractedEventSchema,
  parseShowTime,
  type ExtractedArtist,
  type ExtractedEvent,
  type Issue
} from '@live-info/schema'
import type { VenueExtractConfig } from './config'
import { inferYear, toIsoDate, type YearMonth } from './dates'
import { collapse, matchesCondition, normalizeUrl, re, resolveValue, textWithBreaks, type Scope } from './values'

export interface ExtractContext {
  now: Date
  sourceUrl: string
  venueId: string
}

export interface SkippedItem {
  index: number
  reason: string
  snippet: string
}

// 検証で見つかった問題。index は DOM 上の item の通し番号（0 始まり）。
export type ExtractionIssue = Issue & { index: number }

export interface ExtractionResult {
  events: ExtractedEvent[]
  itemCount: number
  skipped: SkippedItem[]
  issues: ExtractionIssue[]
}

type ItemOutcome =
  | { kind: 'event'; event: ExtractedEvent; issues: Issue[]; date: YearMonth | null; inferred: boolean }
  | { kind: 'skip'; reason: string }

const SNIPPET_LENGTH = 80

// "9:00" → "09:00"。全角は parseShowTime 側で NFKC 化されるので、ここでは桁だけ揃える。
const padTime = (text: string): string => text.normalize('NFKC').replace(/^(\d):/, '0$1:')

function resolveDate(config: VenueExtractConfig, scope: Scope, now: Date, prev: YearMonth | null) {
  const rule = config.fields.date
  const raw = resolveValue(rule.source, scope)
  const m = raw === null ? null : re(rule.pattern).exec(raw)
  const month = Number(m?.groups?.['month'])
  const day = Number(m?.groups?.['day'])
  if (!m || !Number.isInteger(month) || !Number.isInteger(day)) return null

  const yearFrom = (groups: Record<string, string | undefined> | undefined): number | null => {
    if (groups?.['year']) return Number(groups['year'])
    if (groups?.['yy']) return 2000 + Number(groups['yy'])
    return null
  }
  let year = yearFrom(m.groups)
  if (year === null && rule.year_source) {
    const ysRaw = resolveValue(rule.year_source.source, scope)
    year = yearFrom((ysRaw === null ? null : re(rule.year_source.pattern).exec(ysRaw))?.groups)
  }
  const inferred = year === null && !rule.year_source
  if (year === null) {
    if (!inferred) return null
    year = inferYear(month, day, prev, now)
  }
  return { date: toIsoDate(year, month, day), ym: { year, month }, inferred }
}

function resolveTitle(config: VenueExtractConfig, scope: Scope): string | null {
  const rule = config.fields.title
  const values = rule.sources.map((s) => resolveValue(s, scope)).filter((v): v is string => v !== null)
  if (values.length === 0) return null
  return rule.mode === 'first' ? (values[0] ?? null) : values.join(' ')
}

function resolveArtists(config: VenueExtractConfig, item: HTMLElement): ExtractedArtist[] {
  const rule = config.fields.artists
  if (!rule) return []
  const els = item.querySelectorAll(rule.selector)
  const raws =
    rule.split === undefined
      ? els.map((el) => el.text)
      : els.slice(0, 1).flatMap((el) => textWithBreaks(el).split(new RegExp(rule.split ?? '', 'u')))
  const strips = (rule.strip ?? []).map((s) => new RegExp(s, 'gu'))
  const excludes = (rule.exclude ?? []).map(re)
  const names = raws
    .map((raw) => collapse(strips.reduce((acc, r) => acc.replace(r, ''), raw)))
    .filter((name) => name !== '' && !excludes.some((r) => r.test(name)))
  return [...new Set(names)].map((name) => ({ name }))
}

function resolveTimes(config: VenueExtractConfig, scope: Scope): { open: string | null; start: string | null } {
  const rule = config.fields.times
  const none = { open: null, start: null }
  if (!rule) return none
  const raw = resolveValue(rule.source, scope)
  if (raw === null) return none
  for (const pattern of rule.patterns) {
    const m = re(pattern).exec(raw)
    if (m) return { open: m.groups?.['open'] ?? null, start: m.groups?.['start'] ?? null }
  }
  return none
}

// 時刻は parseShowTime を通す。0:00〜28:59 は受け入れ、29:00 以上や不正な書式は null にして issue を残す。
function checkTime(raw: string | null, date: string, field: 'open_text' | 'start_text', issues: Issue[]): string | null {
  if (raw === null) return null
  const parsed = parseShowTime(date, padTime(raw))
  if (parsed.ok) return parsed.start_text
  issues.push({ code: 'invalid_start_time', field, message: `time "${raw}" rejected: ${parsed.reason}` })
  return null
}

function resolveStatus(config: VenueExtractConfig, item: HTMLElement): ExtractedEvent['status'] {
  return config.fields.status?.find((rule) => matchesCondition(rule.when, item))?.value ?? null
}

function extractItem(config: VenueExtractConfig, item: HTMLElement, page: HTMLElement, ctx: ExtractContext, prev: YearMonth | null): ItemOutcome {
  const scope: Scope = { page, item, sourceUrl: ctx.sourceUrl }

  const skip = config.skip?.find((rule) => matchesCondition(rule.when, item))
  if (skip) return { kind: 'skip', reason: skip.reason }

  const title = resolveTitle(config, scope)
  if (title === null) return { kind: 'skip', reason: 'missing title' }
  const resolved = resolveDate(config, scope, ctx.now, prev)
  if (resolved === null) return { kind: 'skip', reason: 'missing or unreadable date' }

  const issues: Issue[] = []
  const times = resolveTimes(config, scope)
  const rawDetail = config.fields.detail_url ? resolveValue(config.fields.detail_url, scope) : null
  const rawTicket = config.fields.ticket_url ? resolveValue(config.fields.ticket_url, scope) : null
  const event: ExtractedEvent = {
    title_ja: title,
    date: resolved.date,
    open_text: checkTime(times.open, resolved.date, 'open_text', issues),
    start_text: checkTime(times.start, resolved.date, 'start_text', issues),
    price_text: config.fields.price_text ? resolveValue(config.fields.price_text, scope) : null,
    price_min_jpy: null,
    status: resolveStatus(config, item),
    ticket_url: rawTicket === null ? null : normalizeUrl(rawTicket, ctx.sourceUrl),
    source_url: (rawDetail === null ? null : normalizeUrl(rawDetail, ctx.sourceUrl)) ?? ctx.sourceUrl,
    artists: resolveArtists(config, item)
  }
  return { kind: 'event', event, issues, date: resolved.ym, inferred: resolved.inferred }
}

// 設定（A）に従って HTML から公演を取り出す。LLM は使わない。結果の並びは DOM の並び。
export function extractEvents(html: string, config: VenueExtractConfig, ctx: ExtractContext): ExtractionResult {
  const page = parse(html)
  const items = page.querySelectorAll(config.item)
  const events: ExtractedEvent[] = []
  const skipped: SkippedItem[] = []
  const issues: ExtractionIssue[] = []
  let prev: YearMonth | null = null

  for (const [index, item] of items.entries()) {
    const snippet = collapse(item.text).slice(0, SNIPPET_LENGTH)
    const outcome = extractItem(config, item, page, ctx, prev)
    if (outcome.kind === 'skip') {
      skipped.push({ index, reason: outcome.reason, snippet })
      continue
    }
    const parsed = extractedEventSchema.safeParse(outcome.event)
    if (!parsed.success) {
      const detail = parsed.error.issues.map((i) => i.path.join('.')).join(',')
      skipped.push({ index, reason: `schema validation failed: ${detail}`, snippet })
      continue
    }
    events.push(parsed.data)
    issues.push(...outcome.issues.map((issue) => ({ ...issue, index })))
    prev = outcome.inferred ? outcome.date : prev
  }

  return { events, itemCount: items.length, skipped, issues }
}
