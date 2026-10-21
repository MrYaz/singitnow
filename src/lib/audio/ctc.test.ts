import { describe, expect, it } from 'vitest'
import { applyCtc, forceAlign, makeVocab, tokenize, words } from './ctc'
import type { Section } from '../types'

const tokens = ['▁hello', '▁h', 'e', 'l', 'o', '▁w', 'or', 'd', '▁', 'a', '<blk>']
const v = makeVocab(tokens)

describe('speech-model timing', () => {
  it('splits words into the longest known pieces', () => {
    expect(tokenize('hello', v)).toEqual([0])
    expect(tokenize('world', v)).toEqual([5, 6, 3, 7])
    expect(words("It’s Koppången, 2 times!")).toEqual(["it's", 'koppangen', 'times'])
  })

  it('finds when each token is sung', () => {
    // 10 frames: blank, blank, hello, hello, blank, w, or, l, d, blank
    const V = tokens.length
    const seq = [10, 10, 0, 0, 10, 5, 6, 3, 7, 10]
    const lp = new Float32Array(seq.length * V).fill(-20)
    seq.forEach((k, t) => (lp[t * V + k] = 0))
    const { first, last } = forceAlign(lp, seq.length, V, [0, 5, 6, 3, 7], 10)
    expect(Array.from(first)).toEqual([2, 5, 6, 7, 8])
    expect(last[0]).toBe(3)
  })

  it('sets line times from the alignment', () => {
    const V = tokens.length
    const seq = [...Array(25).fill(10), 0, 0, ...Array(23).fill(10), 5, 6, 3, 7, ...Array(10).fill(10)]
    const lp = new Float32Array(seq.length * V).fill(-20)
    seq.forEach((k, t) => (lp[t * V + k] = 0))
    const line = (text: string) => ({ text, segs: [{ text, harmony: false, adlib: false }], harmony: false, adlib: false })
    const secs: Section[] = [{ pdfStart: 0, pdfEnd: null, rest: false, note: null, others: [], lines: [line('Hello'), line('world')] }]
    const out = applyCtc(secs, lp, seq.length, V, v)
    expect(out[0].lines[0].start).toBeCloseTo(0.9, 2)
    expect(out[0].lines[1].start).toBeCloseTo(1.9, 2)
    expect(out[0].start).toBeCloseTo(0.9, 2)
  })
})
