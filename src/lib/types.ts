/** A piece of a lyric line. `harmony` = colour-marked in the PDF (stämsång). */
export interface LineSeg {
  text: string
  harmony: boolean
  adlib: boolean
}

export interface Line {
  text: string
  segs: LineSeg[]
  harmony: boolean
  /** Whole line in italics, usually an echo or a background part. */
  adlib: boolean
  /** Seconds in the audio, set by the analysis (or by hand). */
  start?: number
  end?: number
}

export interface Section {
  /** Start time written in the PDF, in seconds. */
  pdfStart: number | null
  pdfEnd: number | null
  /** Start/end found in the audio. */
  start?: number
  end?: number
  /** The voice rests in this part ("*tyst*"). */
  rest: boolean
  /** A stage note such as "Alla nynnar melodin". */
  note: string | null
  /** What the other voices sing meanwhile (right-hand column). */
  others: string[]
  lines: Line[]
}

export interface ParsedLyrics {
  title: string
  sections: Section[]
}

export type TrackKind = 'voice' | 'alla' | 'musik' | 'solo' | 'pdf'

export interface StoredFile {
  id: string
  songId: string
  name: string
  kind: TrackKind
  voice?: string
  size: number
  modified?: string
  blob: Blob
}

export interface VoiceTrack {
  voice: string
  audioFileId: string
  pdfFileId: string
  title: string
  sections: Section[]
  /** How the line times were found: by the speech model, or from pauses in the singing. */
  timing?: 'speech' | 'pauses'
  /** When the voice sings, in seconds. */
  spans?: [number, number][]
  /** Singing activity, 2 values per second, 0..1. */
  activity: number[]
  analyzedAt: number
}

export interface Song {
  id: string
  title: string
  folder: string
  order: number
  duration: number
  allaFileId?: string
  musikFileId?: string
  voices: Record<string, VoiceTrack>
  addedAt: number
}
