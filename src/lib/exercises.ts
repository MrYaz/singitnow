import type { Line, Section } from './types'

/** Lesson levels for one section (formdel), easiest first. */
export const LEVELS = [
  { name: 'Lyssna', blurb: 'Lyssna på ALLA och din stämma och följ med i texten.' },
  { name: 'Saknar ord', blurb: 'Välj ordet som saknas.' },
  { name: 'Ordbrickor', blurb: 'Bygg raden av ordbrickor.' },
  { name: 'Första bokstaven', blurb: 'Bara första bokstaven syns. Sjung raden!' },
  { name: 'Minnesluckor', blurb: 'Orden försvinner, du fyller i.' },
  { name: 'Sjung själv', blurb: 'Musiken pausar, du sjunger nästa rad.' },
] as const

export type Exercise =
  | { type: 'listen'; track: 'alla' | 'voice'; section: number }
  | { type: 'choose'; section: number; line: number; blank: number; options: string[] }
  | { type: 'tiles'; section: number; line: number; tiles: string[] }
  | { type: 'order'; section: number; lines: number[] }
  | { type: 'initials'; section: number; line: number }
  | { type: 'fade'; section: number; line: number; hidden: number[] }
  | { type: 'sing'; section: number; line: number }

export const tokens = (text: string) => text.split(/\s+/).filter(Boolean)
export const bare = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '')

const VOCABLE = /^(oh|ohh|ooh|ah|aah|woh|wo|whoa|oo|uh|la|na|mm|hm|hey|yeah|eh|ha|da|doo|ba|sha|oh-oh|wo-oh)$/
const isVocable = (w: string) =>
  w
    .toLowerCase()
    .replace(/[^\p{L}\p{N}'-]/gu, '')
    .split('-')
    .every((p) => VOCABLE.test(p) || p === '')

/** A line worth word exercises: some real words, not just "oh-oh-oh". */
export function isWordy(line: Line): boolean {
  const ws = tokens(line.text.replace(/[()…]/g, ''))
  return ws.filter((w) => !isVocable(w) && bare(w).length > 0).length >= 2
}

export function initials(text: string): string {
  return tokens(text)
    .filter((w) => /[\p{L}\p{N}]/u.test(w))
    .map((w) => {
      const m = w.match(/^([^\p{L}\p{N}]*)([\p{L}\p{N}])/u)
      return m ? m[1] + m[2] : w
    })
    .join(' ')
}

/** Deterministic shuffle so a lesson is stable while you do it. */
export function shuffle<T>(xs: T[], seed: number): T[] {
  const a = [...xs]
  let s = seed || 1
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 16807) % 2147483647
    const j = s % (i + 1)
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** Picks the word to blank out: a content word, not "the" or "I". */
export function blankIndex(text: string, seed: number): number {
  const ws = tokens(text)
  const scored = ws
    .map((w, i) => ({ i, len: bare(w).length, v: isVocable(w) }))
    .filter((x) => !x.v && x.len >= 3)
  if (!scored.length) return Math.max(0, ws.length - 1)
  const pool = scored.sort((a, b) => b.len - a.len).slice(0, 3)
  return pool[seed % pool.length].i
}

export function chooseOptions(answer: string, pool: string[], seed: number): string[] {
  const a = bare(answer)
  const seen = new Set([a])
  const cands = shuffle(
    pool.filter((w) => {
      const b = bare(w)
      if (!b || seen.has(b) || isVocable(w) || b.length < 2) return false
      seen.add(b)
      return true
    }),
    seed,
  ).sort((x, y) => Math.abs(bare(x).length - a.length) - Math.abs(bare(y).length - a.length))
  const clean = (w: string) => w.replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, '')
  return shuffle([clean(answer), ...cands.slice(0, 3).map(clean)], seed + 7)
}

/** Words to hide in the fading exercise: `share` of the words, longest first. */
export function fadeMask(text: string, share: number, seed: number): number[] {
  const ws = tokens(text)
  const n = Math.max(1, Math.round(ws.length * share))
  return shuffle(
    ws.map((_, i) => i),
    seed,
  )
    .sort((a, b) => bare(ws[b]).length - bare(ws[a]).length)
    .slice(0, n)
}

/** Builds the exercises for one level of one section. */
export function buildLesson(sections: Section[], s: number, level: number, seed = Date.now() % 100000): Exercise[] {
  const sec = sections[s]
  const lines = sec.lines.map((l, i) => ({ l, i }))
  const wordy = lines.filter((x) => isWordy(x.l))
  const pool = sections.flatMap((x) => x.lines.flatMap((l) => tokens(l.text)))
  const ex: Exercise[] = []
  switch (level) {
    case 0:
      ex.push({ type: 'listen', track: 'alla', section: s }, { type: 'listen', track: 'voice', section: s })
      break
    case 1:
      for (const { l, i } of wordy) {
        const blank = blankIndex(l.text, seed + i)
        ex.push({ type: 'choose', section: s, line: i, blank, options: chooseOptions(tokens(l.text)[blank], pool, seed + i) })
      }
      if (lines.length >= 3) ex.push({ type: 'order', section: s, lines: shuffle(lines.map((x) => x.i), seed) })
      break
    case 2:
      for (const { l, i } of wordy) ex.push({ type: 'tiles', section: s, line: i, tiles: shuffle(tokens(l.text), seed + i) })
      break
    case 3:
      for (const { i } of lines) ex.push({ type: 'initials', section: s, line: i })
      break
    case 4:
      for (const { l, i } of wordy) ex.push({ type: 'fade', section: s, line: i, hidden: fadeMask(l.text, 0.5, seed + i) })
      for (const { l, i } of wordy) ex.push({ type: 'fade', section: s, line: i, hidden: fadeMask(l.text, 1, seed + i) })
      break
    default:
      for (const { i } of lines) ex.push({ type: 'sing', section: s, line: i })
  }
  if (!ex.length) for (const { i } of lines) ex.push({ type: 'sing', section: s, line: i })
  return ex
}

/** A review exercise for one line, harder the better you know it. */
export function reviewExercise(sections: Section[], s: number, line: number, reps: number, seed: number): Exercise {
  const l = sections[s].lines[line]
  if (!isWordy(l)) return { type: 'sing', section: s, line }
  const pool = sections.flatMap((x) => x.lines.flatMap((y) => tokens(y.text)))
  if (reps <= 1) {
    const blank = blankIndex(l.text, seed)
    return { type: 'choose', section: s, line, blank, options: chooseOptions(tokens(l.text)[blank], pool, seed) }
  }
  if (reps <= 3) return { type: 'tiles', section: s, line, tiles: shuffle(tokens(l.text), seed) }
  if (reps % 2 === 0) return { type: 'fade', section: s, line, hidden: fadeMask(l.text, 1, seed) }
  return { type: 'initials', section: s, line }
}

/** Sections that have lyrics to learn for this voice. */
export const learnable = (sections: Section[]) =>
  sections.map((s, i) => ({ s, i })).filter((x) => x.s.lines.length > 0)

/** The screen for practising one section of a song with one learning method. */
export function lessonFor(song: { id: string; title: string; voices: Record<string, { sections: Section[] }> }, voice: string, section: number, level: number) {
  const sections = song.voices[voice].sections
  const part = learnable(sections).findIndex((x) => x.i === section) + 1
  return {
    name: 'lesson' as const,
    title: `${song.title} · ${LEVELS[level].name} · del ${part}`,
    items: buildLesson(sections, section, level).map((ex) => ({ songId: song.id, voice, ex })),
    level: { songId: song.id, voice, section, level },
  }
}
