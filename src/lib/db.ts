import Dexie, { type Table } from 'dexie'
import type { Card } from 'ts-fsrs'
import type { Song, StoredFile } from './types'

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
  level: number
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

  constructor() {
    super('singitnow')
    this.version(1).stores({
      songs: 'id, order',
      files: 'id, songId',
      cards: 'key, songId, voice, due',
      progress: 'key, songId, voice',
      kv: 'key',
    })
  }
}

export const db = new SingItDB()

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
