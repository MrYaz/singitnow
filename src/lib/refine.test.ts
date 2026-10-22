import { describe, expect, it, vi } from 'vitest'
vi.mock('./db', () => ({ db: {} }))
vi.mock('./audio/analyze', () => ({}))
import { needsRefine } from './refine'
import type { Song } from './types'

const song = (id: string, voices: Record<string, 'speech' | 'pauses'>) =>
  ({ id, voices: Object.fromEntries(Object.entries(voices).map(([v, timing]) => [v, { voice: v, timing }])) }) as unknown as Song

describe('needsRefine', () => {
  it('takes your voice in every song first, then the other voices', () => {
    const songs = [song('a', { Sopran: 'pauses', 'Alt 2': 'pauses' }), song('b', { 'Alt 1': 'pauses', 'Alt 2': 'speech' })]
    const order = needsRefine(songs, (s) => (s.voices['Alt 2'] ? 'Alt 2' : null)).map((x) => `${x.song.id} ${x.voice}`)
    expect(order).toEqual(['a Alt 2', 'a Sopran', 'b Alt 1'])
  })
})
