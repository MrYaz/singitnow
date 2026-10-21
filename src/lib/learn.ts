import { createEmptyCard, fsrs, Rating, type Card, type Grade } from 'ts-fsrs'
import { db, getKV, setKV } from './db'

export { Rating }
const scheduler = fsrs({ enable_fuzz: true })

export const cardKey = (songId: string, voice: string, s: number, l: number) => `${songId}|${voice}|${s}|${l}`
export const sectionKey = (songId: string, voice: string, s: number) => `${songId}|${voice}|${s}`

export async function rateLine(songId: string, voice: string, s: number, l: number, grade: Grade) {
  const key = cardKey(songId, voice, s, l)
  const row = await db.cards.get(key)
  const now = new Date()
  const card: Card = row ? { ...row.card, due: new Date(row.card.due), last_review: row.card.last_review ? new Date(row.card.last_review) : undefined } : createEmptyCard(now)
  const next = scheduler.next(card, now, grade).card
  await db.cards.put({ key, songId, voice, due: next.due.getTime(), card: next })
}

export async function dueLines(voices: string[], limit = 12) {
  const now = Date.now()
  const rows = await db.cards.where('due').belowOrEqual(now).filter((r) => voices.includes(r.voice)).toArray()
  return rows.sort((a, b) => a.due - b.due).slice(0, limit)
}

const maskOf = (r: { level: number; done?: number }) => r.done ?? (1 << r.level) - 1

/** Learning methods done per section, as bit masks (bit m = method m is done). */
export async function doneFor(songId: string, voice: string): Promise<Record<number, number>> {
  const rows = await db.progress.where('songId').equals(songId).filter((r) => r.voice === voice).toArray()
  const out: Record<number, number> = {}
  for (const r of rows) out[Number(r.key.split('|')[2])] = maskOf(r)
  return out
}

export const isDone = (mask: number | undefined, method: number) => ((mask ?? 0) >> method) & 1

export async function completeMethod(songId: string, voice: string, s: number, method: number) {
  const key = sectionKey(songId, voice, s)
  const cur = await db.progress.get(key)
  const done = (cur ? maskOf(cur) : 0) | (1 << method)
  await db.progress.put({ key, songId, voice, level: Math.max(cur?.level ?? 0, method + 1), done })
}

// ---- Daily goal and streak -------------------------------------------------

export const today = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const yesterday = () => today(new Date(Date.now() - 864e5))

export interface Streak {
  count: number
  last: string | null
}

export async function addXP(xp: number) {
  const key = `xp:${today()}`
  await setKV(key, (await getKV<number>(key, 0)) + xp)
  const s = await getKV<Streak>('streak', { count: 0, last: null })
  if (s.last !== today()) await setKV('streak', { count: s.last === yesterday() ? s.count + 1 : 1, last: today() })
}

export async function getStreak(): Promise<Streak> {
  const s = await getKV<Streak>('streak', { count: 0, last: null })
  // A streak is alive if you practised today or yesterday.
  if (s.last !== today() && s.last !== yesterday()) return { count: 0, last: s.last }
  return s
}

export const todayXP = () => getKV<number>(`xp:${today()}`, 0)

// ---- Settings --------------------------------------------------------------

export interface Settings {
  /** The voices you sing, most preferred first. Each song uses the first one it has. */
  voices: string[]
  silent: boolean
  dailyGoal: number
  driveUrl: string
}

export const defaultSettings: Settings = { voices: [], silent: false, dailyGoal: 50, driveUrl: '' }

export async function getSettings(): Promise<Settings> {
  const saved = await getKV<Partial<Settings> & { voice?: string | null }>('settings', {})
  // Older versions stored a single voice.
  if (!saved.voices && saved.voice) saved.voices = [saved.voice]
  delete saved.voice
  return { ...defaultSettings, ...saved }
}

export async function saveSettings(patch: Partial<Settings>) {
  const cur = await getSettings()
  await setKV('settings', { ...cur, ...patch })
}
