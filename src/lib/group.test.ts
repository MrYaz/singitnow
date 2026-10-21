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
      f('HT26/6. Old time rock_n_roll/text/Old time rock’n’roll - Alt2.pdf'),
      f('HT26/Infomapp/Tips för att lära dig låtar.pdf'),
    ])
    expect(g.map((x) => x.id)).toEqual(['why-did-it-have-to-be-me', 'old-time-rock-n-roll'])
    expect(g[0].files.map((x) => x.kind).sort()).toEqual(['musik', 'pdf', 'voice'])
    expect(g[1].files.find((x) => x.kind === 'pdf')?.voice).toBe('Alt 2')
  })
  it('matches loose files by name', () => {
    const g = groupSongs([
      f('Musik - Old Time Rock & Roll.mp3'),
      f('Alt 2 - Old Time Rock & roll.mp3'),
      f('Old time rock’n’roll - Alt2.pdf'),
      f('Musik - Fix you.mp3'),
      f('Alt2- Fix you.pdf'),
    ])
    expect(g).toHaveLength(2)
    const rock = g.find((x) => x.folder.startsWith('Old'))!
    expect(rock.files.map((x) => x.kind).sort()).toEqual(['musik', 'pdf', 'voice'])
    expect(g.find((x) => x.folder === 'Fix you')!.files).toHaveLength(2)
  })
})
