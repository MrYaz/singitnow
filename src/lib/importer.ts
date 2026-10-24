import { db } from './db'
import { folderTitle, groupSongs, type SongGroup } from './group'
import { DriveError, driveFile, type SourceFile } from './sources'
import type { PendingSong, Song, StoredFile, VoiceTrack } from './types'
import { readLyricsPdf } from './pdf/load'
import { analyzeInWorker, decodeForAnalysis } from './audio/analyze'
import { ANALYSIS_RATE } from './audio/activity'
import { alignLyrics } from './audio/align'
import { keepAwake } from './wakelock'
import { holdRefine, needsRefine, refineVoice } from './refine'
import { pickVoice } from './names'

export type Progress = (msg: string, done: number, total: number) => void

/** Bump when the analysis changes so stored songs get re-analysed. */
export const ANALYSIS_VERSION = 1

async function storeFile(g: SongGroup, gf: SongGroup['files'][number], report: () => void): Promise<StoredFile> {
  const existing = await db.files.get(gf.file.id)
  if (existing && existing.modified === gf.file.modified && existing.size === gf.file.size) return existing
  const blob = await gf.file.load()
  report()
  const row: StoredFile = {
    id: gf.file.id,
    songId: g.id,
    name: gf.file.name,
    kind: gf.kind,
    voice: gf.voice,
    size: gf.file.size || blob.size,
    modified: gf.file.modified,
    blob,
  }
  await db.files.put(row)
  return row
}

/** Whether a song is new or changed since it was last imported, without downloading anything. */
async function songStatus(g: SongGroup) {
  const prev = await db.songs.get(g.id)
  const changed = await Promise.all(
    g.files.map(async (f) => {
      const e = await db.files.get(f.file.id)
      return !e || e.modified !== f.file.modified || e.size !== f.file.size
    }),
  )
  const changedIds = new Set(g.files.filter((_, k) => changed[k]).map((f) => f.file.id))
  // Only voices with lyrics become part of a song, so a voice file without a PDF is not "missing".
  const withLyrics = (v?: string) => g.files.some((f) => f.kind === 'pdf' && f.voice === v)
  const missingVoices = g.files.some((f) => f.kind === 'voice' && f.voice && withLyrics(f.voice) && !prev?.voices[f.voice])
  const goneVoices = Object.keys(prev?.voices ?? {}).some((v) => !g.files.some((f) => f.kind === 'voice' && f.voice === v))
  const needed = !prev || changed.some(Boolean) || missingVoices || goneVoices || (prev as Song & { v?: number }).v !== ANALYSIS_VERSION
  return { prev, changedIds, needed }
}

/**
 * Notes the songs in a Drive listing that are new or changed, without downloading anything.
 * Each one is downloaded and analysed the first time it is opened (fetchSong), so a slow
 * device spreads the work over several sittings. Returns the noted songs.
 */
export async function addSongs(sources: SourceFile[]): Promise<PendingSong[]> {
  const groups = groupSongs(sources)
  if (!groups.length) throw new Error('Hittade inga låtar. Varje låt behöver minst en Musik-fil och en stämfil.')
  const out: PendingSong[] = []
  for (const g of groups) {
    const { prev, changedIds, needed } = await songStatus(g)
    if (!needed) continue
    const withLyrics = (v?: string) => g.files.some((f) => f.kind === 'pdf' && f.voice === v)
    out.push({
      id: g.id,
      title: prev?.title ?? folderTitle(g.folder),
      folder: g.folder,
      order: g.order,
      voices: [...new Set(g.files.filter((f) => f.kind === 'voice' && f.voice && withLyrics(f.voice)).map((f) => f.voice!))],
      size: g.files.filter((f) => changedIds.has(f.file.id)).reduce((a, f) => a + f.file.size, 0),
      update: !!prev,
      files: g.files.map(({ file: f }) => ({ driveId: f.driveId!, path: f.path, name: f.name, size: f.size, modified: f.modified })),
    })
  }
  // The listing is the whole folder, so it replaces what was noted before.
  await db.transaction('rw', db.pending, async () => {
    await db.pending.clear()
    await db.pending.bulkPut(out)
  })
  return out
}

/** True when every file came from Drive, so the songs can be noted now and downloaded later. */
export const canWaitToFetch = (sources: SourceFile[]) => sources.length > 0 && sources.every((s) => s.driveId)

/**
 * Downloads and analyses one noted song, then times every voice's lines with the speech model,
 * your voices first (`mine`). Throws ImportError if Drive would not give the files.
 * Stopped during the timing, the song is still saved and the rest is timed in the background later.
 */
export async function fetchSong(id: string, onProgress: Progress, signal?: AbortSignal, mine: string[] = []): Promise<Song | undefined> {
  const row = await db.pending.get(id)
  if (!row) return db.songs.get(id)
  // Downloading and the first analysis are the smaller part; the speech model takes most of the time.
  const DL = 0.35
  const resume = holdRefine()
  // One screen lock for the whole job: the import lets go of its own when the download is done.
  const release = keepAwake()
  try {
    await importSources(row.files.map((f) => driveFile(f)), (msg, done, total) => onProgress(msg, DL * (total ? done / total : 0), 1), false, signal)
    await db.pending.delete(id)
    const first = await db.songs.get(id)
    if (!first) return undefined
    const voices = needsRefine([first], (s) => pickVoice(s.voices, mine)).map((x) => x.voice)
    for (let i = 0; i < voices.length; i++) {
      signal?.throwIfAborted()
      const label = `Finsynkar texten för ${voices[i]} (${i + 1}/${voices.length})`
      onProgress(`${label}…`, DL + ((1 - DL) * i) / voices.length, 1)
      try {
        const song = (await db.songs.get(id))!
        await refineVoice(song, voices[i], (share, loading) =>
          onProgress(
            loading === undefined
              ? `${label}, ${Math.round(share * 100)} %`
              : loading > 0
                ? `${label}: laddar ner talmodellen, bara första gången (${Math.round(loading * 100)} %)`
                : `${label}: startar talmodellen…`,
            DL + ((1 - DL) * (i + share)) / voices.length,
            1,
          ),
        )
      } catch (e) {
        // The rough timing still works; the background sync tries again later.
        console.warn('Could not refine', id, voices[i], e)
      }
    }
    return db.songs.get(id)
  } finally {
    release()
    resume()
  }
}

/** Downloads and analyses every noted song, for those who want it all at once. Stops when `signal` aborts. */
export async function fetchAllSongs(onProgress: Progress, signal?: AbortSignal, mine: string[] = []): Promise<number> {
  const rows = await db.pending.orderBy('order').toArray()
  const failed: { name: string; url?: string }[] = []
  const got: Song[] = []
  for (let i = 0; i < rows.length; i++) {
    try {
      signal?.throwIfAborted()
      const song = await fetchSong(rows[i].id, (msg, done, total) => onProgress(msg, i + (total ? done / total : 0), rows.length), signal, mine)
      if (song) got.push(song)
    } catch (e) {
      if (signal?.aborted) throw e
      failed.push(...(e instanceof ImportError ? e.failed : [{ name: rows[i].title }]))
    }
  }
  if (failed.length) throw new ImportError(got, failed)
  return got.length
}

/**
 * Imports songs: stores the files, reads every PDF and finds each line in the audio.
 * Songs whose files did not change are skipped unless `force` is set.
 */
export async function importSources(sources: SourceFile[], onProgress: Progress, force = false, signal?: AbortSignal): Promise<Song[]> {
  // The phone pauses the page if the screen turns off, so keep it on until the import is done.
  const release = keepAwake()
  // The background sync waits, so the two do not fight over a slow device.
  const resume = holdRefine()
  try {
    return await importAll(sources, onProgress, force, signal)
  } finally {
    resume()
    release()
  }
}

async function importAll(sources: SourceFile[], onProgress: Progress, force: boolean, signal?: AbortSignal): Promise<Song[]> {
  const groups = groupSongs(sources)
  if (!groups.length) throw new Error('Hittade inga låtar. Varje låt behöver minst en Musik-fil och en stämfil.')
  const imported: Song[] = []
  let failed: { g: SongGroup; name: string; url?: string }[] = []
  let step = 0
  let total = groups.length
  const pass = async (list: SongGroup[]) => {
    for (const g of list) {
      const { prev, changedIds, needed } = await songStatus(g)
      if (!needed && !force) {
        step++
        continue
      }
      const name = folderTitle(g.folder)
      try {
        onProgress(`Hämtar ${name}`, step, total)
        const stored: StoredFile[] = []
        let n = 0
        for (const f of g.files) {
          // Stopping keeps the files already downloaded, so going on later starts where it stopped.
          signal?.throwIfAborted()
          stored.push(await storeFile(g, f, () => onProgress(`Hämtar ${name} (${++n}/${g.files.length})`, step, total)))
        }
        const musik = stored.find((s) => s.kind === 'musik')!
        const alla = stored.find((s) => s.kind === 'alla')
        onProgress(`Lyssnar på ${name}`, step + 0.1, total)
        const music = await decodeForAnalysis(musik.blob)
        // Rebuilt from the current files only, so voices removed from the folder disappear.
        const voices: Record<string, VoiceTrack> = {}
        const voiceFiles = stored.filter((s) => s.kind === 'voice' && s.voice)
        let title = prev?.title ?? name
        for (let i = 0; i < voiceFiles.length; i++) {
          signal?.throwIfAborted()
          const vf = voiceFiles[i]
          const pdf = stored.find((s) => s.kind === 'pdf' && s.voice === vf.voice)
          if (!pdf) continue
          const old = prev?.voices[vf.voice!]
          const same = old && old.audioFileId === vf.id && old.pdfFileId === pdf.id && !changedIds.has(vf.id) && !changedIds.has(pdf.id)
          if (same && !force && (prev as Song & { v?: number }).v === ANALYSIS_VERSION) {
            // Unchanged files: keep the analysis, including any timings adjusted by hand.
            voices[vf.voice!] = old
            continue
          }
          onProgress(`Analyserar ${name}: ${vf.voice}`, step + 0.2 + (0.8 * i) / voiceFiles.length, total)
          const lyrics = await readLyricsPdf(pdf.blob)
          if (lyrics.title.includes(' - ')) title = lyrics.title.split(' - ')[0].trim()
          const voice = await decodeForAnalysis(vf.blob)
          const res = await analyzeInWorker(voice.pcm, music.pcm)
          // Quick first timing from pauses in the singing; refine.ts improves it later with the speech model.
          const sections = alignLyrics(lyrics, res.spans, voice.pcm.length / ANALYSIS_RATE)
          voices[vf.voice!] = {
            voice: vf.voice!,
            audioFileId: vf.id,
            pdfFileId: pdf.id,
            title: lyrics.title,
            sections,
            timing: 'pauses',
            spans: res.spans,
            activity: res.activity,
            analyzedAt: Date.now(),
          }
        }
        if (!Object.keys(voices).length) {
          step++
          continue
        }
        const song: Song & { v: number } = {
          id: g.id,
          title,
          folder: g.folder,
          order: g.order,
          duration: music.duration,
          allaFileId: alla?.id,
          musikFileId: musik.id,
          voices,
          addedAt: prev?.addedAt ?? Date.now(),
          v: ANALYSIS_VERSION,
        }
        await db.songs.put(song)
        imported.push(song)
        onProgress(`${title} klar`, step + 1, total)
      } catch (e) {
        if (signal?.aborted) throw e
        // One song failing should not stop the rest. It is fetched again next time, since it is not saved.
        console.warn('Could not import', name, e instanceof DriveError ? e.url : '', e)
        failed.push({ g, name, url: e instanceof DriveError ? e.url : undefined })
      }
      step++
    }
  }
  await pass(groups)
  // Google sometimes turns requests away for a short while. Wait, then try the failed songs once more.
  const again = failed.filter((f) => f.url)
  if (again.length) {
    for (let s = 30; s > 0; s--) {
      signal?.throwIfAborted()
      onProgress(`Google Drive svarar inte just nu för ${songList(again.map((f) => f.name))}. Försöker igen om ${s} s…`, step, total)
      await new Promise((r) => setTimeout(r, 1000))
    }
    failed = failed.filter((f) => !f.url)
    step = 0
    total = again.length
    await pass(again.map((f) => f.g))
  }
  if (failed.length) throw new ImportError(imported, failed)
  return imported
}

/** "Fix you", "Fix you och This is me", or "5 låtar" when there are many. */
export function songList(names: string[]): string {
  if (names.length > 2) return `${names.length} låtar`
  return names.join(' och ')
}

/** Some songs could not be fetched; the others were imported. */
export class ImportError extends Error {
  imported: Song[]
  failed: { name: string; url?: string }[]
  constructor(imported: Song[], failed: { name: string; url?: string }[]) {
    const ok = imported.length ? `${imported.length} ${imported.length === 1 ? 'låt' : 'låtar'} inlästa, men ` : ''
    super(`${ok}${songList(failed.map((f) => f.name))} gick inte att hämta just nu. Google stänger ibland av ett nätverk en stund när det har hämtat mycket. Byt till mobildata (stäng av wifi) och försök igen, eller vänta några timmar. Det som redan är hämtat sparas.`)
    this.imported = imported
    this.failed = failed.map(({ name, url }) => ({ name, url }))
  }
}
