import { describe, expect, it } from 'vitest'
import { playedThrough } from './learn'

const secs = [
  { lines: [], start: 0, end: 9 }, // intro, nothing to sing
  { lines: ['a'], start: 9, end: 17 },
  { lines: ['b'], start: 18, end: 26 },
  { lines: ['c'] }, // not timed
]

describe('playedThrough', () => {
  it('counts a part played from before its start past its end', () => {
    expect(playedThrough(secs, 8.4, 16.9, 17.05)).toEqual([1])
  })
  it('does not count a part joined in the middle', () => {
    expect(playedThrough(secs, 12, 16.9, 17.05)).toEqual([])
  })
  it('counts a part only at the moment its end is passed', () => {
    expect(playedThrough(secs, 8.4, 17.1, 17.2)).toEqual([])
  })
  it('skips parts with nothing to sing or no timing', () => {
    expect(playedThrough(secs, 0, 8.9, 9.1)).toEqual([])
  })
})
