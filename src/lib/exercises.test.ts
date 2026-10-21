import { describe, expect, it } from 'vitest'
import { blankIndex, buildLesson, chooseOptions, initials, isWordy } from './exercises'
import type { Section } from './types'

const line = (text: string) => ({ text, segs: [{ text, harmony: false, adlib: false }], harmony: false, adlib: false })
const secs: Section[] = [
  {
    pdfStart: 8,
    pdfEnd: null,
    rest: false,
    note: null,
    others: [],
    lines: [line('When you were lonely, you needed a man'), line('Someone to lean on, well I understand'), line('Oh-oh-oh-oh')],
  },
]

describe('exercises', () => {
  it('knows which lines have real words', () => {
    expect(isWordy(secs[0].lines[0])).toBe(true)
    expect(isWordy(secs[0].lines[2])).toBe(false)
    expect(isWordy(line('(Oh-oh-oh), oh-oh-oh, oh, oh'))).toBe(false)
  })
  it('shows first letters', () => {
    expect(initials('"Hide away, " they say')).toBe('"H a t s')
  })
  it('blanks a content word and offers four distinct options', () => {
    const i = blankIndex('When you were lonely, you needed a man', 1)
    expect(['lonely,', 'needed', 'When', 'were']).toContain('When you were lonely, you needed a man'.split(' ')[i])
    const o = chooseOptions('lonely,', ['lonely', 'needed', 'understand', 'Someone', 'lean', 'man'], 3)
    expect(o).toContain('lonely')
    expect(new Set(o.map((x) => x.toLowerCase())).size).toBe(o.length)
  })
  it('builds every level', () => {
    for (let lv = 0; lv < 6; lv++) expect(buildLesson(secs, 0, lv, 5).length).toBeGreaterThan(0)
    expect(buildLesson(secs, 0, 1, 5).some((e) => e.type === 'order')).toBe(true)
  })
})
