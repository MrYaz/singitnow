import type { Line, ParsedLyrics, Section } from '../types'
import type { Span } from './activity'

const syllables = (t: string) => Math.max(1, (t.match(/[aeiouyåäöAEIOUYÅÄÖ]+/g) ?? []).length)
const r2 = (x: number) => Math.round(x * 100) / 100

/** The sung span starting closest to `guess` within [lo, hi]. */
function findOnset(spans: Span[], guess: number, lo: number, hi: number): number | null {
  let best: number | null = null
  for (const s of spans) {
    if (s[0] < lo || s[0] > hi) continue
    if (best === null || Math.abs(s[0] - guess) < Math.abs(best - guess)) best = s[0]
  }
  return best
}

/**
 * Gives each line a start and end inside [t0, t1], cutting at the pauses
 * (gaps between sung spans) that best fit the lines' syllable counts.
 */
export function splitLines(spans: Span[], t0: number, t1: number, lines: Line[]): { bounds: Span[]; start: number; end: number } | null {
  const ss: Span[] = spans.filter((s) => s[1] > t0 && s[0] < t1).map((s) => [Math.max(s[0], t0), Math.min(s[1], t1)])
  if (!ss.length || !lines.length) return null
  const start = ss[0][0]
  const end = ss.at(-1)![1]
  const total = end - start
  const L = lines.length
  const w = lines.map((l) => syllables(l.text))
  const ws = w.reduce((a, b) => a + b, 0)
  const W = w.map((x) => x / ws)
  const gaps: Span[] = []
  for (let i = 0; i + 1 < ss.length; i++) gaps.push([ss[i][1], ss[i + 1][0]])

  const proportional = (): Span[] => {
    const cuts: number[] = [start]
    let acc = 0
    for (let i = 0; i < L; i++) {
      acc += W[i]
      cuts.push(start + acc * total)
    }
    // Snap each cut to a nearby pause when there is one.
    const out: Span[] = []
    for (let i = 0; i < L; i++) out.push([cuts[i], cuts[i + 1]])
    for (let i = 0; i + 1 < L; i++) {
      const c = cuts[i + 1]
      let near: Span | null = null
      for (const g of gaps) if (!near || Math.abs((g[0] + g[1]) / 2 - c) < Math.abs((near[0] + near[1]) / 2 - c)) near = g
      if (near && Math.abs((near[0] + near[1]) / 2 - c) < 1) {
        out[i][1] = near[0]
        out[i + 1][0] = near[1]
      }
    }
    return out
  }

  if (L === 1 || gaps.length < L - 1) return { bounds: proportional(), start, end }

  // Dynamic programming: choose L-1 of the gaps as line breaks.
  const G = gaps.length
  const INF = 1e9
  const glen = gaps.map((g) => g[1] - g[0])
  const cost = (i: number, a: number, b: number) => 40 * ((b - a) / total - W[i]) ** 2
  const dp: number[][] = Array.from({ length: L }, () => new Array(G + 1).fill(INF))
  const back: number[][] = Array.from({ length: L }, () => new Array(G + 1).fill(-1))
  for (let j = 0; j < G; j++) dp[0][j] = cost(0, start, gaps[j][0]) - glen[j]
  for (let i = 1; i < L; i++) {
    for (let j = i; j <= G; j++) {
      if ((i === L - 1) !== (j === G)) continue
      const e = j === G ? end : gaps[j][0]
      const bonus = j === G ? 0 : glen[j]
      for (let k = i - 1; k < j; k++) {
        if (dp[i - 1][k] >= INF) continue
        const v = dp[i - 1][k] + cost(i, gaps[k][1], e) - bonus
        if (v < dp[i][j]) {
          dp[i][j] = v
          back[i][j] = k
        }
      }
    }
  }
  const cuts: number[] = []
  let j = G
  for (let i = L - 1; i > 0; i--) {
    j = back[i][j]
    if (j < 0) return { bounds: proportional(), start, end }
    cuts.push(j)
  }
  cuts.reverse()
  const pts = [start, ...cuts.flatMap((c) => gaps[c]), end]
  const bounds: Span[] = []
  for (let i = 0; i < L; i++) bounds.push([pts[2 * i], pts[2 * i + 1]])
  return { bounds, start, end }
}

/** Places every section and line of a voice in time, using the PDF times as hints. */
export function alignLyrics(parsed: ParsedLyrics, spans: Span[], duration: number): Section[] {
  const secs = parsed.sections
  const out: Section[] = []
  for (let i = 0; i < secs.length; i++) {
    const s = secs[i]
    const sec: Section = { ...s, lines: s.lines.map((l) => ({ ...l, segs: l.segs.map((g) => ({ ...g })) })) }
    out.push(sec)
    if (s.pdfStart === null) continue
    if (!s.lines.length) {
      sec.start = s.pdfStart
      if (s.pdfEnd !== null) sec.end = s.pdfEnd
      continue
    }
    const nextStart = secs.slice(i + 1).find((x) => x.pdfStart !== null)?.pdfStart ?? duration
    const prevEnd = [...out].reverse().find((x) => x !== sec && x.end !== undefined)?.end ?? 0
    let on = findOnset(spans, s.pdfStart, s.pdfStart - 6, Math.min(s.pdfStart + 8, nextStart))
    if (on === null || on < prevEnd - 0.05) on = Math.max(s.pdfStart, prevEnd)
    // The section ends where the next one with lyrics begins.
    let nextOn: number | null = null
    for (const x of secs.slice(i + 1)) {
      if (x.pdfStart === null) continue
      nextOn = x.lines.length ? findOnset(spans, x.pdfStart, x.pdfStart - 6, x.pdfStart + 8) : x.pdfStart
      break
    }
    const limit = nextOn !== null ? nextOn - 0.05 : duration
    const r = splitLines(spans, on, limit, s.lines)
    if (!r) {
      sec.start = on
      sec.end = Math.min(limit, on + 4 * s.lines.length)
      const step = (sec.end - on) / s.lines.length
      sec.lines.forEach((l, k) => {
        l.start = r2(on + k * step)
        l.end = r2(on + (k + 1) * step)
      })
      continue
    }
    sec.start = r2(r.start)
    sec.end = r2(r.end)
    sec.lines.forEach((l, k) => {
      l.start = r2(r.bounds[k][0])
      l.end = r2(r.bounds[k][1])
    })
  }
  return out
}
