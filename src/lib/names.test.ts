import { describe, expect, it } from 'vitest'
import { classify, similarity, songNameFromFile, voiceFromName } from './names'

describe('file names', () => {
  it('reads the voice from Sing It file names', () => {
    expect(voiceFromName('Alt 2 - Why did it have to be me.mp3')).toBe('Alt 2')
    expect(voiceFromName('Alt1 - Fix you.mp3')).toBe('Alt 1')
    expect(voiceFromName('A2 - This is me .pdf')).toBe('Alt 2')
    expect(voiceFromName('Sop 1 - This is me .pdf')).toBe('Sopran 1')
    expect(voiceFromName('Sopran 2 - This is me.mp3')).toBe('Sopran 2')
    expect(voiceFromName('Sopran - Koppången.mp3')).toBe('Sopran')
    expect(voiceFromName(' Sopran - Love my life.pdf')).toBe('Sopran')
    expect(voiceFromName('Old time rock’n’roll - Alt1.pdf')).toBe('Alt 1')
    expect(voiceFromName('ALLA - Fix you.mp3')).toBeNull()
  })
  it('classifies tracks', () => {
    expect(classify('ALLA - Fix you.mp3')).toEqual({ kind: 'alla' })
    expect(classify('Musik - Fix you.mp3')).toEqual({ kind: 'musik' })
    expect(classify('Solistdel - This is me.mp3')).toEqual({ kind: 'solo' })
    expect(classify('Alt2- Fix you.pdf')).toEqual({ kind: 'pdf', voice: 'Alt 2' })
    expect(classify('Fix you rep 2.mov')).toBeNull()
  })
  it('matches song names across files', () => {
    expect(songNameFromFile('Alt 2 - Why did it have to be me.mp3')).toBe('Why did it have to be me')
    expect(songNameFromFile('Old time rock’n’roll - Alt1.pdf')).toBe('Old time rock’n’roll')
    expect(similarity('Old time rock’n’roll', 'Old Time Rock & Roll')).toBeGreaterThan(0.7)
  })
})
