import { fft } from './fft'

/**
 * Finds when a voice sings by comparing its practice file (voice + backing)
 * with the backing-only "Musik" file. Both are mono, ANALYSIS_RATE Hz.
 * What the voice file has on top of the backing, in the singing band, is the voice.
 */
export const ANALYSIS_RATE = 16000
const WIN = 1024
const HOP = 320
/** Activity frames per second. */
export const FRAME_RATE = ANALYSIS_RATE / HOP
const LO_HZ = 200
const HI_HZ = 3500

function bandSpectrogram(x: Float32Array): { frames: number; bins: number; data: Float32Array } {
  const frames = Math.max(0, Math.floor((x.length - WIN) / HOP))
  const lo = Math.ceil((LO_HZ * WIN) / ANALYSIS_RATE)
  const hi = Math.floor((HI_HZ * WIN) / ANALYSIS_RATE)
  const bins = hi - lo + 1
  const data = new Float32Array(frames * bins)
  const win = new Float32Array(WIN)
  for (let i = 0; i < WIN; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (WIN - 1))
  const re = new Float32Array(WIN)
  const im = new Float32Array(WIN)
  for (let f = 0; f < frames; f++) {
    const off = f * HOP
    for (let i = 0; i < WIN; i++) {
      re[i] = x[off + i] * win[i]
      im[i] = 0
    }
    fft(re, im)
    for (let b = 0; b < bins; b++) {
      const k = lo + b
      data[f * bins + b] = Math.hypot(re[k], im[k])
    }
  }
  return { frames, bins, data }
}

function median(v: Float32Array): number {
  const s = Float32Array.from(v).sort()
  return s.length ? s[s.length >> 1] : 0
}

/** Per-frame share (0..1) of the voice file's energy that the backing does not explain. */
export function computeActivity(voice: Float32Array, music: Float32Array): Float32Array {
  const A = bandSpectrogram(voice)
  const M = bandSpectrogram(music)
  const n = Math.min(A.frames, M.frames)
  const bins = A.bins
  const ea = new Float32Array(n)
  const em = new Float32Array(n)
  for (let f = 0; f < n; f++) {
    let sa = 0
    let sm = 0
    for (let b = 0; b < bins; b++) {
      sa += A.data[f * bins + b]
      sm += M.data[f * bins + b]
    }
    ea[f] = sa
    em[f] = sm
  }
  // The files can be shifted by a few milliseconds; find the best lag.
  let lag = 0
  let best = -Infinity
  for (let l = -50; l <= 50; l++) {
    let c = 0
    for (let f = 100; f < n - 100; f++) {
      const g = f - l
      if (g >= 0 && g < n) c += ea[f] * em[g]
    }
    if (c > best) {
      best = c
      lag = l
    }
  }
  const mAt = (f: number, b: number) => {
    const g = f - lag
    return g >= 0 && g < n ? M.data[g * bins + b] : 0
  }
  // How loud the backing is inside the voice file, per frequency bin.
  const gain = new Float32Array(bins)
  const tmp = new Float32Array(n)
  for (let b = 0; b < bins; b++) {
    for (let f = 0; f < n; f++) tmp[f] = A.data[f * bins + b] / (mAt(f, b) + 1e-6)
    gain[b] = median(tmp)
  }
  const ex = new Float32Array(n)
  for (let f = 0; f < n; f++) {
    let extra = 0
    let total = 0
    for (let b = 0; b < bins; b++) {
      const a = A.data[f * bins + b]
      extra += Math.max(0, a - gain[b] * mAt(f, b))
      total += a
    }
    ex[f] = total < 1e-3 ? 0 : extra / (total + 1e-6)
  }
  // Smooth over 5 frames (100 ms).
  const out = new Float32Array(n)
  for (let f = 0; f < n; f++) {
    let s = 0
    let c = 0
    for (let k = -2; k <= 2; k++) {
      const g = f + k
      if (g >= 0 && g < n) {
        s += ex[g]
        c++
      }
    }
    out[f] = s / c
  }
  return out
}

export type Span = [number, number]

/** Turns activity into sung spans in seconds. */
export function sungSpans(act: ArrayLike<number>, th = 0.2, minGap = 0.12, minLen = 0.15): Span[] {
  const spans: Span[] = []
  let i = 0
  while (i < act.length) {
    if (act[i] > th) {
      let j = i
      while (j < act.length && act[j] > th) j++
      spans.push([i / FRAME_RATE, j / FRAME_RATE])
      i = j
    } else i++
  }
  const merged: Span[] = []
  for (const s of spans) {
    const last = merged.at(-1)
    if (last && s[0] - last[1] < minGap) last[1] = s[1]
    else merged.push([s[0], s[1]])
  }
  return merged.filter((s) => s[1] - s[0] >= minLen)
}

/** Activity resampled to 2 values per second, for storing and drawing. */
export function compactActivity(act: Float32Array): number[] {
  const step = FRAME_RATE / 2
  const out: number[] = []
  for (let i = 0; i < act.length; i += step) {
    let m = 0
    for (let k = i; k < Math.min(act.length, i + step); k++) m = Math.max(m, act[k])
    out.push(Math.round(m * 100) / 100)
  }
  return out
}
