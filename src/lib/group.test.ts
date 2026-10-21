import { describe, expect, it } from 'vitest'
import { groupSongs } from './group'
import type { SourceFile } from './sources'

const f = (path: string): SourceFile => {
  const parts = path.split('/')
  return { id: path, path: parts.slice(0, -1), name: parts.at(-1)!, size: 1, load: async () => new Blob() }
}

describe('groupSongs', () => {
  it('uses song folders when there are folders', () => {
    const g = groupSongs([
      f('HT26/1. Why did it have to be me/Alt 2 - Why did it have to be me.mp3'),
      f('HT26/1. Why did it have to be me/Musik - Why did it have to be me.mp3'),
      f('HT26/1. Why did it have to be me/Text/Alt 2 - Why did it have to be me.pdf'),
      f('HT26/6. Old time rock_n_roll/Musik - Old Time Rock & Roll.mp3'),
      f('HT26/6. Old time rock_n_roll/Alt 2 - Old Time Rock & roll.mp3'),
      f('HT26/6. Old time rock_n_roll/text/Old time rock’n’roll - Alt2.pdf'),
      f('HT26/Infomapp/Tips för att lära dig låtar.pdf'),
    ])
    expect(g.map((x) => x.id)).toEqual(['why-did-it-have-to-be-me', 'old-time-rock-n-roll'])
    expect(g[0].files.map((x) => x.kind).sort()).toEqual(['musik', 'pdf', 'voice'])
    expect(g[1].files.find((x) => x.kind === 'pdf')?.voice).toBe('Alt 2')
  })
  it('keeps sibling folders with a shared prefix apart', () => {
    const g = groupSongs([
      f('HT/Song/Musik - Song.mp3'),
      f('HT/Song/Alt 2 - Song.mp3'),
      f('HT/Song/Text/Alt 2 - Song.pdf'),
      f('HT/Song reprise/Musik - Song reprise.mp3'),
      f('HT/Song reprise/Alt 2 - Song reprise.mp3'),
      f('HT/Song reprise/Text/Alt 2 - Song reprise.pdf'),
    ])
    expect(g).toHaveLength(2)
    for (const grp of g) expect(grp.files).toHaveLength(3)
  })
  it('skips songs without a voice that has lyrics', () => {
    expect(groupSongs([f('HT/A/Musik - A.mp3'), f('HT/A/Alt 2 - A.mp3')])).toHaveLength(0)
    expect(groupSongs([f('HT/A/Musik - A.mp3'), f('HT/A/Text/Alt 2 - A.pdf')])).toHaveLength(0)
  })
  it('matches loose files by name', () => {
    const g = groupSongs([
      f('Musik - Old Time Rock & Roll.mp3'),
      f('Alt 2 - Old Time Rock & roll.mp3'),
      f('Old time rock’n’roll - Alt2.pdf'),
      f('Musik - Fix you.mp3'),
      f('Alt 2 - Fix you.mp3'),
      f('Alt2- Fix you.pdf'),
    ])
    expect(g).toHaveLength(2)
    const rock = g.find((x) => x.folder.startsWith('Old'))!
    expect(rock.files.map((x) => x.kind).sort()).toEqual(['musik', 'pdf', 'voice'])
    expect(g.find((x) => x.folder === 'Fix you')!.files).toHaveLength(3)
  })
})
