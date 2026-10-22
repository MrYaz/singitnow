import type { Section, Song } from './types'

/** Labels in a PDF's right-hand column that name a choir voice ("Sop:", "Alt1:", "Alla:"), not e.g. "Solist:". */
const CHOIR_LABEL = /^(s|sop|sopran|a|alt|alla)\s*\d?\s*:/i

/** Start of a section in the audio, or as written in the PDF. */
const startOf = (s: Section) => s.start ?? s.pdfStart

/**
 * One voice's sections with what every other voice sings, read from the other voices' own PDFs.
 * Parts where only the others sing become "tyst" sections, so the whole song shows up.
 * The right-hand column of the voice's own PDF is kept only for parts no other PDF covers (a soloist).
 */
export function withAllVoices(song: Song, voice: string): Section[] {
  const own = song.voices[voice]
  if (!own) return []
  const others = Object.values(song.voices).filter((v) => v.voice !== voice)
  if (!others.length) return own.sections

  const out: Section[] = own.sections.map((s) => ({ ...s, others: keepNonChoir(s.others) }))
  const theirs = others
    .flatMap((v) => v.sections.filter((s) => s.lines.length && startOf(s) != null).map((s) => ({ voice: v.voice, s })))
    .sort((a, b) => startOf(a.s)! - startOf(b.s)!)

  for (const { voice: who, s } of theirs) {
    const at = startOf(s)!
    const k = findHome(out, at)
    // Lines this voice already sings, or another voice was already listed for, are not repeated.
    const seen = new Set(k >= 0 ? [...out[k].lines.map((l) => norm(l.text)), ...out[k].others.map(norm)] : [])
    const lines = s.lines
      .map((l) => l.text)
      .filter((t) => !seen.has(norm(t)))
      .map((t, i) => (i === 0 ? `${who}: ${t}` : t))
    if (!lines.length) continue
    if (k >= 0) out[k].others.push(...lines)
    else {
      const rest: Section = { pdfStart: s.pdfStart ?? at, pdfEnd: s.pdfEnd, start: s.start, end: s.end, rest: true, note: null, others: lines, lines: [] }
      const pos = out.findIndex((x) => (startOf(x) ?? 0) > at)
      out.splice(pos < 0 ? out.length : pos, 0, rest)
    }
  }
  // A part with only the others' lines is a rest for this voice, even when the PDF does not say "tyst".
  for (const s of out) if (!s.lines.length && !s.note && s.others.length) s.rest = true
  return out
}

/** The section another voice's part belongs to: the one it starts in, if that one is still going then. */
function findHome(list: Section[], at: number): number {
  let k = -1
  for (let i = 0; i < list.length; i++) {
    const st = startOf(list[i])
    if (st != null && st <= at + 1.5) k = i
  }
  if (k < 0) return -1
  const s = list[k]
  const next = list.slice(k + 1).map(startOf).find((x) => x != null) ?? Infinity
  // Without a known end, a part lasts until the next one. A rest always lasts until the next part.
  const end = s.rest || s.end == null ? next : Math.min(s.end + 1, next)
  return at < end ? k : -1
}

/** Text without a voice label, case or punctuation, to spot the same line. */
const norm = (t: string) =>
  t
    .replace(/^[\p{L}\d ]{1,12}:\s*/u, '')
    .toLowerCase()
    .replace(/[^\p{L}\d]+/gu, ' ')
    .trim()

/** Drops lines that belong to a labelled choir voice, keeping e.g. a soloist's lines. */
function keepNonChoir(others: string[]): string[] {
  let choir = false
  return others.filter((o) => {
    if (/^[\p{L}\d ]{1,12}:/u.test(o)) choir = CHOIR_LABEL.test(o)
    return !choir
  })
}
