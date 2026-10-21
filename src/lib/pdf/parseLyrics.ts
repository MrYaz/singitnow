import type { Line, LineSeg, ParsedLyrics, Section } from '../types'
import type { PdfPage, PdfRect, PdfText } from './extract'

/**
 * Sing It's lyric sheets have three columns:
 *   timestamps (x < 100pt) | this voice's lyrics | what the other voices sing (x >= 270pt)
 * Colour highlights mark stämsång, italics mark echoes / background parts.
 */
const TS_MAX_X = 100
const OTHERS_MIN_X = 270
const ZW = /[\u200b\ufeff]/g

const clean = (s: string) => s.replace(ZW, '').replace(/\u00a0/g, ' ')

export function toSeconds(t: string): number | null {
  const m = t.match(/(\d+):(\d{2})/)
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

interface Word {
  text: string
  /** x where the whole text run starts: decides the column. */
  runX: number
  x0: number
  x1: number
  y: number
  size: number
  italic: boolean
  harmony: boolean
}

function overlap(a0: number, a1: number, b0: number, b1: number) {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0))
}

/** Split a text run into words with estimated x ranges and mark highlighted ones. */
function words(t: PdfText, highlights: PdfRect[]): Word[] {
  const s = clean(t.str)
  if (!s.trim()) return []
  const out: Word[] = []
  const re = /\S+/g
  let m: RegExpExecArray | null
  const cw = t.w / Math.max(1, s.length)
  while ((m = re.exec(s))) {
    const x0 = t.x + m.index * cw
    const x1 = x0 + m[0].length * cw
    const y0 = t.y - t.size * 0.2
    const y1 = t.y + t.size * 0.8
    const harmony = highlights.some(
      (r) => overlap(x0, x1, r.x0, r.x1) > 0.5 * (x1 - x0) && overlap(y0, y1, r.y0, r.y1) > 0.4 * (y1 - y0),
    )
    out.push({ text: m[0], runX: t.x, x0, x1, y: t.y, size: t.size, italic: t.italic, harmony })
  }
  return out
}

function joinWords(ws: Word[]): string {
  let s = ''
  for (let i = 0; i < ws.length; i++) {
    if (i > 0) {
      const gap = ws[i].x0 - ws[i - 1].x1
      // Runs from different text items may touch ("(Oh-oh-oh), oh") – keep a space unless punctuation follows.
      s += gap > -0.5 && !/^[,.!?;:]/.test(ws[i].text) ? ' ' : ''
    }
    s += ws[i].text
  }
  return s.replace(/\s+/g, ' ').trim()
}

function toSegs(ws: Word[]): LineSeg[] {
  const segs: LineSeg[] = []
  for (const w of ws) {
    const last = segs.at(-1)
    if (last && last.harmony === w.harmony && last.adlib === w.italic) last.text += ' ' + w.text
    else segs.push({ text: w.text, harmony: w.harmony, adlib: w.italic })
  }
  for (const s of segs) s.text = s.text.replace(/ ([,.!?;:])/g, '$1')
  return segs
}

export function parseLyrics(pages: PdfPage[]): ParsedLyrics {
  // Flatten pages into one top-to-bottom list of rows.
  type Row = { y: number; words: Word[] }
  const rows: Row[] = []
  pages.forEach((pg, pi) => {
    const ws = pg.texts.flatMap((t) => words(t, pg.highlights))
    const offset = pi * -10000
    ws.sort((a, b) => b.y - a.y || a.x0 - b.x0)
    for (const w of ws) {
      const y = w.y + offset
      const row = rows.find((r) => Math.abs(r.y - y) <= 3.5)
      if (row) row.words.push(w)
      else rows.push({ y, words: [w] })
    }
  })
  rows.sort((a, b) => b.y - a.y)
  for (const r of rows) r.words.sort((a, b) => a.x0 - b.x0)

  let title = ''
  const sections: Section[] = []
  let cur: Section | null = null
  const newSection = (start: number | null, end: number | null): Section => {
    const s: Section = { pdfStart: start, pdfEnd: end, rest: false, note: null, others: [], lines: [] }
    sections.push(s)
    return s
  }

  for (const row of rows) {
    const ts = row.words.filter((w) => w.runX < TS_MAX_X)
    const own = row.words.filter((w) => w.runX >= TS_MAX_X && w.runX < OTHERS_MIN_X)
    const oth = row.words.filter((w) => w.runX >= OTHERS_MIN_X)
    const tsText = joinWords(ts)
    const stamps = tsText.match(/\d+:\d{2}/g)

    if (!title && !stamps && sections.length === 0) {
      title = joinWords(row.words)
      continue
    }
    if (stamps) cur = newSection(toSeconds(stamps[0]), stamps[1] ? toSeconds(stamps[1]) : null)
    else if (ts.length && !cur) cur = newSection(null, null)
    // A note written in the timestamp column (e.g. "*Alla nynnar*") belongs to the section.
    if (!cur) cur = newSection(null, null)

    const ownWords = own.length ? own : stamps ? ts.filter((w) => !/\d+:\d{2}|^[-–]$/.test(w.text)) : []
    if (ownWords.length) {
      const text = joinWords(ownWords)
      if (/^\*?\s*tyst\s*\*?$/i.test(text)) cur.rest = true
      else if (/^\*.*\*$/.test(text)) cur.note = text.replace(/^\*|\*$/g, '').trim()
      else if (/^[\p{L} ]+:$/u.test(text)) {
        /* a label such as "Sop:" */
      } else {
        const segs = toSegs(ownWords)
        const line: Line = {
          text,
          segs,
          harmony: segs.some((s) => s.harmony),
          adlib: segs.every((s) => s.adlib),
        }
        cur.lines.push(line)
      }
    }
    if (oth.length) {
      const t = joinWords(oth)
      if (t && !/^[\p{L} ]+:$/u.test(t)) cur.others.push(t.replace(/^\*|\*$/g, ''))
    }
  }
  // Drop empty sections that only carried a timestamp with nothing after it.
  return { title, sections: sections.filter((s) => s.lines.length || s.rest || s.note || s.others.length) }
}
