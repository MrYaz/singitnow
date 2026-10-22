import { db } from './db'
import { folderTitle, groupSongs, type SongGroup } from './group'
import { DriveError, type SourceFile } from './sources'
import type { Song, StoredFile, VoiceTrack } from './types'
import { readLyricsPdf } from './pdf/load'
import { analyzeInWorker, decodeForAnalysis } from './audio/analyze'
import { ANALYSIS_RATE } from './audio/activity'
import { alignLyrics } from './audio/align'
import { keepAwake } from './wakelock'

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

/** Songs in the folder that are new or changed since last time, to ask before downloading them. */
export async function songsToFetch(sources: SourceFile[]): Promise<{ name: string; isNew: boolean }[]> {
  const out: { name: string; isNew: boolean }[] = []
  for (const g of groupSongs(sources)) {
    const { prev, needed } = await songStatus(g)
    if (needed) out.push({ name: prev?.title ?? folderTitle(g.folder), isNew: !prev })
  }
  return out
}

/**
 * Imports songs: stores the files, reads every PDF and finds each line in the audio.
 * Songs whose files did not change are skipped unless `force` is set.
 */
export async function importSources(sources: SourceFile[], onProgress: Progress, force = false): Promise<Song[]> {
  // The phone pauses the page if the screen turns off, so keep it on until the import is done.
  const release = keepAwake()
  try {
    return await importAll(sources, onProgress, force)
  } finally {
    release()
  }
}

async function importAll(sources: SourceFile[], onProgress: Progress, force: boolean): Promise<Song[]> {
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
    const names = again.map((f) => f.name).join(' och ')
    for (let s = 30; s > 0; s--) {
      onProgress(`${names} krånglade. Försöker igen om ${s} s…`, step, total)
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

/** Some songs could not be fetched; the others were imported. */
export class ImportError extends Error {
  imported: Song[]
  failed: { name: string; url?: string }[]
  constructor(imported: Song[], failed: { name: string; url?: string }[]) {
    const ok = imported.length ? `${imported.length} ${imported.length === 1 ? 'låt' : 'låtar'} inlästa, men ` : ''
    super(`${ok}${failed.map((f) => f.name).join(' och ')} gick inte att hämta just nu. Google Drive krånglar ibland en stund. Försök igen om några minuter, då hämtas bara det som saknas.`)
    this.imported = imported
    this.failed = failed.map(({ name, url }) => ({ name, url }))
  }
}
