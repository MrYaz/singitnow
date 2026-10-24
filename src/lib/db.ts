import Dexie, { type Table } from 'dexie'
import type { Card } from 'ts-fsrs'
import type { PendingSong, Song, StoredFile } from './types'

export interface CardRow {
  /** songId|voice|section|line */
  key: string
  songId: string
  voice: string
  due: number
  card: Card
}

export interface SectionProgress {
  /** songId|voice|section */
  key: string
  songId: string
  voice: string
  /** Older versions: how many steps were done, in order. */
  level: number
  /** Bit per learning method that is done for this section. */
  done?: number
}

export interface KV {
  key: string
  value: unknown
}

class SingItDB extends Dexie {
  songs!: Table<Song, string>
  files!: Table<StoredFile, string>
  cards!: Table<CardRow, string>
  progress!: Table<SectionProgress, string>
  kv!: Table<KV, string>
  pending!: Table<PendingSong, string>

  constructor() {
    super('singitnow')
    this.version(1).stores({
      songs: 'id, order',
      files: 'id, songId',
      cards: 'key, songId, voice, due',
      progress: 'key, songId, voice',
      kv: 'key',
    })
    // Songs listed from Drive but not downloaded yet.
    this.version(2).stores({ pending: 'id, order' })
  }
}

export const db = new SingItDB()

// An older copy of the app in another tab can hold the database while it is upgraded or deleted.
let blocked = false
db.on('blocked', () => {
  blocked = true
})
export const dbBlocked = () => blocked

export async function getKV<T>(key: string, fallback: T): Promise<T> {
  const row = await db.kv.get(key)
  return row ? (row.value as T) : fallback
}

export async function setKV(key: string, value: unknown): Promise<void> {
  await db.kv.put({ key, value })
}

/** Ask the browser not to evict our stored audio. */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (navigator.storage?.persisted && (await navigator.storage.persisted())) return true
    return (await navigator.storage?.persist?.()) ?? false
  } catch {
    return false
  }
}
