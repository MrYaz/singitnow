import { db } from './db'
import type { Song } from './types'
import { decodeForAnalysis, loadTokens, runSpeechModel } from './audio/analyze'
import { applyCtc, isVocalise, makeVocab } from './audio/ctc'
import { alignLyrics } from './audio/align'
import { readLyricsPdf } from './pdf/load'

/** Sung spans from the stored 2-per-second activity, for tracks imported before spans were saved. */
function spansFromActivity(act: number[]): [number, number][] {
  const out: [number, number][] = []
  act.forEach((v, i) => {
    if (v <= 0.2) return
    const last = out.at(-1)
    if (last && last[1] >= i / 2) last[1] = (i + 1) / 2
    else out.push([i / 2, (i + 1) / 2])
  })
  return out
}

/**
 * Times every line of one voice with the speech model, which is far more exact than the
 * pause-based first guess. Takes about half a minute per voice on a laptop.
 */
export async function refineVoice(song: Song, voice: string, onProgress?: (share: number, loading?: number) => void): Promise<void> {
  const track = song.voices[voice]
  const file = await db.files.get(track.audioFileId)
  if (!file) throw new Error('Ljudfilen saknas')
  const { pcm } = await decodeForAnalysis(file.blob)
  const spans = track.spans ?? spansFromActivity(track.activity)
  const out = await runSpeechModel(pcm, spans, onProgress)
  const vocab = makeVocab(await loadTokens())
  const sections = applyCtc(track.sections, out.lp, out.frames, out.vocab, vocab, spans)
  await db.songs.update(song.id, (s) => {
    const t = s.voices[voice]
    // Only if the voice was not re-imported meanwhile.
    if (!t || t.audioFileId !== track.audioFileId) return
    t.sections = sections
    t.timing = 'speech'
  })
}

/** Bump when lyrics reading or fine-sync changes in a way that needs songs already fetched to be redone. */
export const TIMING_VERSION = 2

/**
 * Brings songs fetched with an older version up to date without downloading anything: reads the
 * stored PDF again and redoes the timing of the voices it changes, or that have parts with only
 * sounds ("Oh…"), which the fine-sync now times differently. The background queue then fine-syncs them again.
 */
export async function upgradeTiming(): Promise<void> {
  const songs = (await db.songs.toArray()) as (Song & { tv?: number })[]
  for (const song of songs) {
    if ((song.tv ?? 1) >= TIMING_VERSION) continue
    const redo: Record<string, Song['voices'][string]['sections']> = {}
    for (const [v, track] of Object.entries(song.voices)) {
      try {
        const pdf = await db.files.get(track.pdfFileId)
        if (!pdf) continue
        const lyrics = await readLyricsPdf(pdf.blob)
        const text = (secs: { note: string | null; lines: { text: string }[] }[]) => JSON.stringify(secs.map((x) => [x.note, x.lines.map((l) => l.text)]))
        const vocal = track.sections.some((x) => x.lines.length > 0 && x.lines.every((l) => isVocalise(l.text)))
        if (!vocal && text(lyrics.sections) === text(track.sections)) continue
        redo[v] = alignLyrics(lyrics, track.spans ?? spansFromActivity(track.activity), song.duration)
      } catch (e) {
        console.warn('Could not upgrade', song.title, v, e)
      }
    }
    await db.songs.update(song.id, (s) => {
      for (const [v, sections] of Object.entries(redo)) {
        const t = s.voices[v]
        if (!t) continue
        t.sections = sections
        t.timing = 'pauses'
      }
      ;(s as Song & { tv?: number }).tv = TIMING_VERSION
    })
  }
}

/**
 * Voices that still have the rough timing: first the voice you practise in every song, then all
 * the other voices, since Stämrep and Körrep show what they sing next to yours.
 */
export function needsRefine(songs: Song[], pick: (s: Song) => string | null): { song: Song; voice: string }[] {
  const rough = (song: Song, v: string) => song.voices[v] && song.voices[v].timing !== 'speech'
  const mine = songs.flatMap((song) => {
    const v = pick(song)
    return v && rough(song, v) ? [{ song, voice: v }] : []
  })
  const rest = songs.flatMap((song) =>
    Object.keys(song.voices)
      .filter((v) => v !== pick(song) && rough(song, v))
      .map((voice) => ({ song, voice })),
  )
  return [...mine, ...rest]
}

// ---- Background queue ----------------------------------------------------

let holds = 0
/** Pauses the queue between voices while something heavier runs (an import). Call the result to let it go on. */
export function holdRefine(): () => void {
  holds++
  let done = false
  return () => {
    if (!done) holds--
    done = true
  }
}
const whileHeld = async () => {
  while (holds > 0) await new Promise((r) => setTimeout(r, 1000))
}

type Status = { text: string; share: number } | null
let status: Status = null
let running = false
const listeners = new Set<(s: Status) => void>()
const emit = (s: Status) => {
  status = s
  listeners.forEach((f) => f(s))
}

export function onRefineStatus(f: (s: Status) => void): () => void {
  listeners.add(f)
  f(status)
  return () => listeners.delete(f)
}

/** Refines, one at a time, every voice that still has rough timing, yours first. */
export async function refineInBackground(pick: (s: Song) => string | null): Promise<void> {
  if (running) return
  running = true
  try {
    await upgradeTiming().catch((e) => console.warn('Could not upgrade timings', e))
    const failed = new Set<string>()
    let done = 0
    for (;;) {
      await whileHeld()
      const songs = await db.songs.orderBy('order').toArray()
      const left = needsRefine(songs, pick).filter((x) => !failed.has(`${x.song.id}|${x.voice}`))
      const next = left[0]
      if (!next) break
      // Share is over the whole queue, so the footer shows one steady percentage.
      const total = done + left.length
      const label = `${next.song.title} (${next.voice})`
      emit({ text: label, share: done / total })
      try {
        await refineVoice(next.song, next.voice, (share) => emit({ text: label, share: (done + share) / total }))
      } catch (e) {
        console.warn('Could not refine', label, e)
        failed.add(`${next.song.id}|${next.voice}`)
      }
      done++
    }
  } finally {
    running = false
    emit(null)
  }
}
