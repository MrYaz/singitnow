import { db } from './db'
import { folderTitle, groupSongs, type SongGroup } from './group'
import type { SourceFile } from './sources'
import type { Song, StoredFile, VoiceTrack } from './types'
import { readLyricsPdf } from './pdf/load'
import { analyzeInWorker, decodeForAnalysis } from './audio/analyze'
import { ANALYSIS_RATE } from './audio/activity'
import { alignLyrics } from './audio/align'

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

/**
 * Imports songs: stores the files, reads every PDF and finds each line in the audio.
 * Songs whose files did not change are skipped unless `force` is set.
 */
export async function importSources(sources: SourceFile[], onProgress: Progress, force = false): Promise<Song[]> {
  const groups = groupSongs(sources)
  if (!groups.length) throw new Error('Hittade inga låtar. Varje låt behöver minst en Musik-fil och en stämfil.')
  const imported: Song[] = []
  let step = 0
  const total = groups.length
  for (const g of groups) {
    const prev = await db.songs.get(g.id)
    const changed = await Promise.all(
      g.files.map(async (f) => {
        const e = await db.files.get(f.file.id)
        return !e || e.modified !== f.file.modified || e.size !== f.file.size
      }),
    )
    const changedIds = new Set(g.files.filter((_, k) => changed[k]).map((f) => f.file.id))
    const missingVoices = g.files.some((f) => f.kind === 'voice' && f.voice && !prev?.voices[f.voice])
    const goneVoices = Object.keys(prev?.voices ?? {}).some((v) => !g.files.some((f) => f.kind === 'voice' && f.voice === v))
    if (prev && !force && !changed.some(Boolean) && !missingVoices && !goneVoices && (prev as Song & { v?: number }).v === ANALYSIS_VERSION) {
      step++
      continue
    }
    const name = folderTitle(g.folder)
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
      voices[vf.voice!] = {
        voice: vf.voice!,
        audioFileId: vf.id,
        pdfFileId: pdf.id,
        title: lyrics.title,
        sections: alignLyrics(lyrics, res.spans, voice.pcm.length / ANALYSIS_RATE),
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
    step++
    onProgress(`${title} klar`, step, total)
  }
  return imported
}
