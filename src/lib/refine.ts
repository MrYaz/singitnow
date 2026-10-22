import { db } from './db'
import type { Song } from './types'
import { decodeForAnalysis, loadTokens, runSpeechModel } from './audio/analyze'
import { applyCtc, makeVocab } from './audio/ctc'

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
export async function refineVoice(song: Song, voice: string, onProgress?: (share: number) => void): Promise<void> {
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
    const failed = new Set<string>()
    let done = 0
    for (;;) {
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
