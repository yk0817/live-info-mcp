import type { ArtistLink, ExistingEvent, PreparedEvent, WriteOp } from './types'

const headlinerOf = (artists: readonly ArtistLink[]): string | null => artists[0]?.artistId ?? null

const overlaps = (a: readonly ArtistLink[], b: readonly ArtistLink[]): boolean => {
  const ids = new Set(a.map((x) => x.artistId))
  return b.some((x) => ids.has(x.artistId))
}

export const sameArtists = (a: readonly ArtistLink[], b: readonly ArtistLink[]): boolean =>
  a.length === b.length && a.every((x, i) => x.artistId === b[i]?.artistId && x.role === b[i]?.role && x.order === b[i]?.order)

// start が一致して出演者が重なる（規則 1）、または start がどちらかで空でヘッドライナーが一致する（規則 2）
function looksSame(candidate: ExistingEvent, p: PreparedEvent): boolean {
  if (p.startNorm !== '' && candidate.startNorm === p.startNorm && overlaps(candidate.artists, p.artists)) return true
  if (p.startNorm === '' || candidate.startNorm === '') {
    const headliner = headlinerOf(p.artists)
    return headliner !== null && headliner === headlinerOf(candidate.artists)
  }
  return false
}

function differs(existing: ExistingEvent, p: PreparedEvent, needsReview: boolean): boolean {
  const e = p.event
  return (
    existing.title_ja !== e.title_ja ||
    (e.title_en !== undefined && existing.title_en !== e.title_en) ||
    existing.open_time !== e.open_text ||
    existing.start_at !== p.startAt ||
    existing.start_text !== e.start_text ||
    existing.price_text !== e.price_text ||
    existing.price_min_jpy !== e.price_min_jpy ||
    existing.status !== e.status ||
    existing.ticket_url !== e.ticket_url ||
    existing.source_url !== e.source_url ||
    existing.fingerprint !== p.fingerprint ||
    existing.needs_review !== (needsReview ? 1 : 0)
  )
}

// 設計判断 1（docs/requirements.md）。迷ったら別々に持つ側に倒す。
//   0. 同じ id（venue|date|start|title が同じ）は同一。再抽出で自分自身に当たるための前提
//   1. start が同じで出演者が 1 人以上重なる → 同一
//   2. start がどちらかで空 → ヘッドライナーが一致すれば同一
//   3. それ以外は別公演。同じ会場・日に既存の公演があるのに当たらなければ needs_review
// 1 回の実行で既存の 1 公演に当たれるのは 1 件まで（同じページに並ぶ別カードを 1 件に潰さない）。
// 同じ実行で入れた兄弟カードは「既存」に数えず、flag の理由にしない。
// existing は同じ会場の公演（日付違いを含んでよい）。結果は prepared と同じ並び。
export function planEvents(existing: readonly ExistingEvent[], prepared: readonly PreparedEvent[]): WriteOp[] {
  const matched = new Map<number, ExistingEvent>()
  const claimed = new Set<string>()
  const duplicates = new Set<number>()

  // パス 1: id が同じもの。規則 1・2 で他のカードに横取りされないよう先に確保する
  prepared.forEach((p, index) => {
    const hit = existing.find((e) => e.id === p.id)
    if (!hit) return
    if (claimed.has(hit.id)) duplicates.add(index)
    else {
      claimed.add(hit.id)
      matched.set(index, hit)
    }
  })

  // パス 2: 規則 1・2
  prepared.forEach((p, index) => {
    if (matched.has(index) || duplicates.has(index)) return
    const hit = existing.find((e) => e.date === p.event.date && !claimed.has(e.id) && looksSame(e, p))
    if (!hit) return
    claimed.add(hit.id)
    matched.set(index, hit)
  })

  const insertedIds = new Set<string>()
  return prepared.map((p, index): WriteOp => {
    if (duplicates.has(index)) return { kind: 'duplicate', index }
    const hit = matched.get(index)
    if (hit) {
      // needs_review は一度立てたら更新では下ろさない（人が確認するまで残す）
      const needsReview = p.needsReview || hit.needs_review === 1
      const artistsChanged = !sameArtists(hit.artists, p.artists)
      return {
        kind: 'update',
        index,
        prepared: p,
        existing: hit,
        // 出演者だけの変更も「変更あり」（updated_at を進め、関連を入れ替える）
        changed: artistsChanged || differs(hit, p, needsReview),
        artistsChanged,
        needsReview
      }
    }
    if (insertedIds.has(p.id)) return { kind: 'duplicate', index }
    insertedIds.add(p.id)
    const othersOnDay = existing.some((e) => e.date === p.event.date)
    return { kind: 'insert', index, prepared: p, needsReview: p.needsReview || othersOnDay }
  })
}
