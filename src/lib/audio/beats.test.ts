import { describe, expect, it } from 'vitest'
import { barLoop, beatAt, findBeats, snap, stepBy, type Beats } from './beats'

const RATE = 16000

/** A click track: a loud low thump on each bar's first beat, softer clicks on the others. */
function clicks(bpm: number, meter: number, seconds: number): Float32Array {
  const pcm = new Float32Array(RATE * seconds)
  const period = 60 / bpm
  for (let k = 0; k * period < seconds - 0.1; k++) {
    const o = Math.round((0.5 + k * period) * RATE)
    const down = k % meter === 0
    for (let i = 0; i < 800 && o + i < pcm.length; i++) {
      const env = Math.exp(-i / 150)
      const f = down ? 80 : 1500
      pcm[o + i] += (down ? 0.9 : 0.4) * env * Math.sin((2 * Math.PI * f * i) / RATE)
    }
  }
  return pcm
}

const grid = (bpm: number, n = 64, meter = 4): Beats => ({ bpm, times: Array.from({ length: n }, (_, i) => 1 + (i * 60) / bpm), meter, first: 0 })

describe('findBeats', () => {
  it('finds the tempo of a steady click track', () => {
    const b = findBeats(clicks(120, 4, 30), RATE)!
    expect(b).not.toBeNull()
    expect(b.bpm).toBeGreaterThan(117)
    expect(b.bpm).toBeLessThan(123)
    expect(b.meter).toBe(4)
  })

  it('hears a waltz as 3/4', () => {
    const b = findBeats(clicks(150, 3, 30), RATE)!
    expect(b.meter).toBe(3)
  })

  it('gives up on a clip too short to tell', () => {
    expect(findBeats(clicks(120, 4, 5), RATE)).toBeNull()
  })
})

describe('placing on the beat', () => {
  it('snaps to eighths in a quick song and sixteenths in a slow one', () => {
    const quick = grid(120) // beats every 0.5 s from 1 s: eighths every 0.25 s
    expect(snap(quick, 2.1)).toBe(2)
    expect(snap(quick, 2.2)).toBe(2.25)
    const slow = grid(80) // beats every 0.75 s: sixteenths every 0.1875 s
    expect(snap(slow, 1.2)).toBe(1.19)
  })

  it('steps one subdivision at a time, landing on the grid', () => {
    const b = grid(120)
    expect(stepBy(b, 2.1, 1)).toBe(2.25)
    expect(stepBy(b, 2.1, -1)).toBe(1.75)
  })

  it('makes loops whole bars long, starting just before the line', () => {
    const b = grid(120) // a 4/4 bar is 2 s
    const one = barLoop(b, 3.1, 4.5)
    expect(one).toEqual({ from: 3, to: 5 })
    const two = barLoop(b, 3.1, 5.6)
    expect(two).toEqual({ from: 3, to: 7 })
    // Whole bars: the loop is a multiple of the bar in beats.
    expect((beatAt(b, two.to) - beatAt(b, two.from)) % 4).toBe(0)
  })

  it('follows a beat that slows down', () => {
    const times = [1, 1.5, 2, 2.5, 3, 3.6, 4.2, 4.8, 5.4, 6]
    const b: Beats = { bpm: 110, times, meter: 4, first: 0 }
    expect(barLoop(b, 1, 2.9)).toEqual({ from: 1, to: 3 })
    expect(barLoop(b, 3, 4.5)).toEqual({ from: 3, to: 5.4 })
  })
})
