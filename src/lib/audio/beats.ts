import { fft } from './fft'

/** The beat of a song, found in its Musik track. */
export interface Beats {
  bpm: number
  /** When each beat falls, in seconds. */
  times: number[]
  /** Beats per bar: 3 or 4. */
  meter: number
  /** Index in `times` of the first beat that starts a bar. */
  first: number
}

const HOP = 160 // 10 ms at 16 kHz
const WIN = 512
const BANDS = 24

/**
 * How much new sound starts in each 10 ms frame (spectral flux), for all of the sound and for
 * the low end only, where the bass drum and bass mark the bars.
 */
export function onsetEnvelope(pcm: Float32Array, rate: number): { env: Float32Array; low: Float32Array; fps: number } {
  const frames = Math.max(0, Math.floor((pcm.length - WIN) / HOP))
  const env = new Float32Array(frames)
  const low = new Float32Array(frames)
  const win = new Float32Array(WIN).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / WIN))
  // Bands spaced evenly in pitch from 60 Hz up to 5 kHz.
  const binHz = rate / WIN
  const edges = Array.from({ length: BANDS + 1 }, (_, b) => Math.max(1, Math.round((60 * Math.pow(5000 / 60, b / BANDS)) / binHz)))
  const lowBands = edges.findIndex((e) => e * binHz > 200)
  let prev = new Float32Array(BANDS)
  const re = new Float32Array(WIN)
  const im = new Float32Array(WIN)
  for (let f = 0; f < frames; f++) {
    const o = f * HOP
    for (let i = 0; i < WIN; i++) {
      re[i] = pcm[o + i] * win[i]
      im[i] = 0
    }
    fft(re, im)
    const cur = new Float32Array(BANDS)
    for (let b = 0; b < BANDS; b++) {
      let e = 0
      for (let k = edges[b]; k < Math.max(edges[b] + 1, edges[b + 1]); k++) e += re[k] * re[k] + im[k] * im[k]
      cur[b] = Math.log(1e-6 + e)
    }
    let s = 0
    let sl = 0
    for (let b = 0; b < BANDS; b++) {
      const d = Math.max(0, cur[b] - prev[b])
      s += d
      if (b < lowBands) sl += d
    }
    env[f] = s
    low[f] = sl
    prev = cur
  }
  return { env: normalise(env, rate / HOP), low: normalise(low, rate / HOP), fps: rate / HOP }
}

/** Removes the slow swell (a 1 s moving average) and scales to unit spread. */
function normalise(x: Float32Array, fps: number): Float32Array {
  const w = Math.round(fps / 2)
  const out = new Float32Array(x.length)
  let acc = 0
  const pre = new Float64Array(x.length + 1)
  for (let i = 0; i < x.length; i++) pre[i + 1] = pre[i] + x[i]
  for (let i = 0; i < x.length; i++) {
    const a = Math.max(0, i - w)
    const b = Math.min(x.length, i + w + 1)
    out[i] = Math.max(0, x[i] - (pre[b] - pre[a]) / (b - a))
    acc += out[i] * out[i]
  }
  const sd = Math.sqrt(acc / Math.max(1, x.length)) || 1
  for (let i = 0; i < x.length; i++) out[i] /= sd
  return out
}

/** Beats per minute from the envelope's self-similarity, preferring tempos near 110. */
export function estimateTempo(env: Float32Array, fps: number): number {
  const lo = Math.floor((60 * fps) / 200)
  const hi = Math.ceil((60 * fps) / 50)
  let best = lo
  let bestV = -Infinity
  const ac = new Float64Array(hi + 2)
  for (let lag = lo - 1; lag <= hi + 1; lag++) {
    let s = 0
    for (let i = lag; i < env.length; i++) s += env[i] * env[i - lag]
    ac[lag] = s / (env.length - lag)
  }
  for (let lag = lo; lag <= hi; lag++) {
    const bpm = (60 * fps) / lag
    const w = Math.exp(-0.5 * (Math.log2(bpm / 110) / 0.9) ** 2)
    // A real beat period also lines up at twice its length.
    const v = w * (ac[lag] + 0.5 * (ac[2 * lag] ?? 0))
    if (v > bestV) {
      bestV = v
      best = lag
    }
  }
  // Parabolic interpolation around the peak.
  const a = ac[best - 1]
  const b = ac[best]
  const c = ac[best + 1]
  const d = a - 2 * b + c
  const lag = d < 0 ? best + (0.5 * (a - c)) / d : best
  return (60 * fps) / lag
}

/** Beat times by dynamic programming: strong onsets, evenly spaced (Ellis 2007). */
export function trackBeats(env: Float32Array, fps: number, bpm: number, tightness = 100): number[] {
  const period = (60 * fps) / bpm
  const n = env.length
  const score = new Float64Array(n)
  const back = new Int32Array(n).fill(-1)
  const lo = Math.round(period / 2)
  const hi = Math.round(period * 2)
  for (let t = 0; t < n; t++) {
    let best = 0
    let arg = -1
    for (let tau = t - hi; tau <= t - lo; tau++) {
      if (tau < 0) continue
      const v = score[tau] - tightness * Math.log((t - tau) / period) ** 2
      if (arg < 0 || v > best) {
        best = v
        arg = tau
      }
    }
    score[t] = env[t] + (arg >= 0 ? Math.max(0, best) : 0)
    back[t] = arg >= 0 && best > 0 ? arg : -1
  }
  // Start from the best-scoring frame within the last beat period.
  let t = n - 1
  for (let i = Math.max(0, n - Math.round(period)); i < n; i++) if (score[i] > score[t]) t = i
  const out: number[] = []
  while (t >= 0) {
    out.push(t)
    t = back[t]
  }
  out.reverse()
  // Leading and trailing beats in silence carry no information.
  const loud = (f: number) => {
    let s = 0
    for (let i = Math.max(0, f - 3); i < Math.min(n, f + 4); i++) s += env[i]
    return s > 0.5
  }
  let a = 0
  while (a < out.length && !loud(out[a])) a++
  let b = out.length
  while (b > a && !loud(out[b - 1])) b--
  return out.slice(a, b).map((f) => Math.round((f / fps) * 1000) / 1000)
}

/**
 * Beats per bar and where the bars start: the bar's first beat is the one with most new low sound.
 * 4/4 unless 3/4 is clearly stronger.
 */
export function findMeter(times: number[], low: Float32Array, fps: number): { meter: number; first: number } {
  const at = times.map((t) => {
    const f = Math.round(t * fps)
    let m = 0
    for (let i = Math.max(0, f - 3); i < Math.min(low.length, f + 4); i++) m = Math.max(m, low[i])
    return m
  })
  const contrast = (m: number, p: number) => {
    let on = 0
    let no = 0
    let off = 0
    let nf = 0
    at.forEach((v, i) => {
      if ((i - p) % m === 0) {
        on += v
        no++
      } else {
        off += v
        nf++
      }
    })
    return no && nf ? on / no - off / nf : 0
  }
  const best = (m: number) => {
    let p = 0
    for (let q = 1; q < m; q++) if (contrast(m, q) > contrast(m, p)) p = q
    return { p, c: contrast(m, p) }
  }
  const four = best(4)
  const three = best(3)
  return three.c > 1.3 * four.c && three.c > 0.1 ? { meter: 3, first: three.p } : { meter: 4, first: four.p }
}

/**
 * How well beats at this tempo explain the music: new sound on the beats and halfway between them,
 * mildly preferring tempos near 110.
 */
function tempoFit(env: Float32Array, fps: number, times: number[], bpm: number): number {
  const at = (t: number) => {
    const f = Math.round(t * fps)
    let m = 0
    for (let i = Math.max(0, f - 2); i < Math.min(env.length, f + 3); i++) m = Math.max(m, env[i])
    return m
  }
  let on = 0
  let mid = 0
  for (let i = 0; i + 1 < times.length; i++) {
    on += at(times[i])
    mid += at((times[i] + times[i + 1]) / 2)
  }
  const n = Math.max(1, times.length - 1)
  return ((on + mid) / (2 * n)) * Math.exp(-0.5 * (Math.log2(bpm / 110) / 1.2) ** 2)
}

export function findBeats(music: Float32Array, rate: number): Beats | null {
  const { env, low, fps } = onsetEnvelope(music, rate)
  if (env.length < fps * 10) return null
  // The self-similarity often lands on a related tempo; try those too and keep the best fit.
  const est = estimateTempo(env, fps)
  let bpm = est
  let times: number[] = []
  let fit = -Infinity
  for (const r of [1, 2 / 3, 3 / 4, 4 / 3, 3 / 2]) {
    const cand = est * r
    if (cand < 50 || cand > 210) continue
    const ts = trackBeats(env, fps, cand)
    const f = tempoFit(env, fps, ts, cand)
    if (f > fit) {
      fit = f
      bpm = cand
      times = ts
    }
  }
  if (times.length < 8) return null
  const { meter, first } = findMeter(times, low, fps)
  return { bpm: Math.round(bpm * 10) / 10, times, meter, first }
}

// ---- Placing times on the beat ------------------------------------------------

/** Where a time falls in beats (fractional), following the beats as they speed up or slow down. */
export function beatAt(b: Beats, t: number): number {
  const ts = b.times
  const p0 = ts[1] - ts[0]
  if (t <= ts[0]) return (t - ts[0]) / p0
  const n = ts.length - 1
  if (t >= ts[n]) return n + (t - ts[n]) / (ts[n] - ts[n - 1])
  let lo = 0
  let hi = n
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (ts[mid] <= t) lo = mid
    else hi = mid
  }
  return lo + (t - ts[lo]) / (ts[lo + 1] - ts[lo])
}

/** The time at a (fractional) beat position. */
export function timeAt(b: Beats, beat: number): number {
  const ts = b.times
  const n = ts.length - 1
  if (beat <= 0) return ts[0] + beat * (ts[1] - ts[0])
  if (beat >= n) return ts[n] + (beat - n) * (ts[n] - ts[n - 1])
  const i = Math.floor(beat)
  return ts[i] + (beat - i) * (ts[i + 1] - ts[i])
}

/** Subdivisions per beat used for snapping: eighths in a quick song, sixteenths in a slow one. */
export const subdivisions = (b: Beats) => (b.bpm < 90 ? 4 : 2)

/** The nearest subdivision of the beat to a time. */
export function snap(b: Beats, t: number): number {
  const s = subdivisions(b)
  return round2(timeAt(b, Math.round(beatAt(b, t) * s) / s))
}

/** Moves a time by `steps` subdivisions, landing on the grid. */
export function stepBy(b: Beats, t: number, steps: number): number {
  const s = subdivisions(b)
  return round2(timeAt(b, (Math.round(beatAt(b, t) * s) + steps) / s))
}

/**
 * A loop around [from, to] that is a whole number of bars long, starting on the subdivision just
 * before `from`, so that it goes round in time.
 */
export function barLoop(b: Beats, from: number, to: number): { from: number; to: number } {
  const s = subdivisions(b)
  const start = Math.floor(beatAt(b, from) * s) / s
  const bars = Math.max(1, Math.ceil((beatAt(b, to) - start) / b.meter - 0.05))
  return { from: round2(Math.max(0, timeAt(b, start))), to: round2(timeAt(b, start + bars * b.meter)) }
}

const round2 = (x: number) => Math.round(x * 100) / 100
