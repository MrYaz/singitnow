import { describe, expect, it } from 'vitest'
import { withAllVoices } from './merge'
import type { Line, Section, Song } from './types'

const line = (text: string): Line => ({ text, segs: [{ text, harmony: false, adlib: false }], harmony: false, adlib: false })
const sec = (start: number, lines: string[], extra: Partial<Section> = {}): Section => ({
  pdfStart: start,
  pdfEnd: null,
  rest: false,
  note: null,
  others: [],
  lines: lines.map(line),
  ...extra,
})
const song = (voices: Record<string, Section[]>) =>
  ({ voices: Object.fromEntries(Object.entries(voices).map(([voice, sections]) => [voice, { voice, sections }])) }) as unknown as Song

describe('withAllVoices', () => {
  it('adds what the other voices sing to each part', () => {
    const s = song({
      'Alt 2': [sec(7, ['Turn around'], { others: ['Sop: Every now', 'and then'] }), sec(15, ['Turn around'])],
      Sopran: [sec(7, ['Every now and then I get lonely']), sec(15, ['Every now and then I get tired'])],
    })
    const out = withAllVoices(s, 'Alt 2')
    expect(out).toHaveLength(2)
    // The other PDF replaces the shorter copy in the right-hand column.
    expect(out[0].others).toEqual(['Sopran: Every now and then I get lonely'])
    expect(out[1].others).toEqual(['Sopran: Every now and then I get tired'])
  })

  it('makes a rest of a part only the others sing, and skips lines everyone sings', () => {
    const s = song({
      'Alt 2': [sec(0, ['Together we can'], { end: 10 }), sec(40, ['Once upon a time'])],
      Sopran: [sec(0, ['Together we can!']), sec(20, ['I was so lonesome', 'I was blue'])],
      'Alt 1': [sec(20.5, ['I was so lonesome', 'Ooh'])],
    })
    const out = withAllVoices(s, 'Alt 2')
    expect(out.map((x) => x.pdfStart)).toEqual([0, 20, 40])
    expect(out[0].others).toEqual([])
    expect(out[1].rest).toBe(true)
    expect(out[1].others).toEqual(['Sopran: I was so lonesome', 'I was blue', 'Alt 1: Ooh'])
  })

  it('keeps a soloist from the right-hand column', () => {
    const s = song({ 'Alt 2': [sec(0, [], { rest: true, others: ['Sop: hey', 'Solist: Oh yeah', 'baby'] })], Sopran: [sec(0, ['hey'])] })
    expect(withAllVoices(s, 'Alt 2')[0].others).toEqual(['Solist: Oh yeah', 'baby', 'Sopran: hey'])
  })
})
