import { fft } from './fft'

/**
 * 80-bin log-mel filterbank, matching Kaldi's fbank (25 ms frames, 10 ms hop,
 * Povey window, no edge snipping) as used by the speech model. Input is mono 16 kHz.
 */
export const FBANK_BINS = 80
const SR = 16000
const LEN = 400
const HOP = 160
const NFFT = 512
const EPS = 1.1920929e-7

const mel = (f: number) => 1127 * Math.log(1 + f / 700)

let cache: { win: Float32Array; banks: { start: number; w: Float32Array }[] } | null = null
function setup() {
  if (cache) return cache
  const win = new Float32Array(LEN)
  for (let i = 0; i < LEN; i++) win[i] = Math.pow(0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (LEN - 1)), 0.85)
  const lo = mel(20)
  const hi = mel(SR / 2)
  const delta = (hi - lo) / (FBANK_BINS + 1)
  const banks: { start: number; w: Float32Array }[] = []
  for (let b = 0; b < FBANK_BINS; b++) {
    const left = lo + b * delta
    const center = left + delta
    const right = center + delta
    const w: number[] = []
    let start = -1
    for (let i = 0; i < NFFT / 2; i++) {
      const m = mel((i * SR) / NFFT)
      if (m > left && m < right) {
        if (start < 0) start = i
        w[i - start] = m <= center ? (m - left) / (center - left) : (right - m) / (right - center)
      }
    }
    banks.push({ start, w: Float32Array.from(w) })
  }
  cache = { win, banks }
  return cache
}

/** Returns features as [frames x 80], row-major. */
export function fbank(x: Float32Array): { frames: number; data: Float32Array } {
  const { win, banks } = setup()
  const n = x.length
  const frames = Math.floor((n + HOP / 2) / HOP)
  const data = new Float32Array(frames * FBANK_BINS)
  const re = new Float32Array(NFFT)
  const im = new Float32Array(NFFT)
  const fr = new Float32Array(LEN)
  for (let m = 0; m < frames; m++) {
    const off = m * HOP + HOP / 2 - LEN / 2
    let mean = 0
    for (let i = 0; i < LEN; i++) {
      let k = off + i
      if (k < 0) k = -k - 1
      else if (k >= n) k = 2 * n - 1 - k
      fr[i] = (x[Math.min(Math.max(k, 0), n - 1)] ?? 0) * 32768
      mean += fr[i]
    }
    mean /= LEN
    for (let i = 0; i < LEN; i++) fr[i] -= mean
    for (let i = LEN - 1; i > 0; i--) fr[i] -= 0.97 * fr[i - 1]
    fr[0] -= 0.97 * fr[0]
    re.fill(0)
    im.fill(0)
    for (let i = 0; i < LEN; i++) re[i] = fr[i] * win[i]
    fft(re, im)
    for (let i = 0; i < NFFT / 2; i++) re[i] = re[i] * re[i] + im[i] * im[i]
    for (let b = 0; b < FBANK_BINS; b++) {
      const { start, w } = banks[b]
      let e = 0
      for (let j = 0; j < w.length; j++) e += w[j] * re[start + j]
      data[m * FBANK_BINS + b] = Math.log(Math.max(e, EPS))
    }
  }
  return { frames, data }
}

/** Per-bin mean/variance normalisation, in place (the model's "per_feature" mode). */
export function normalizeFeatures(f: { frames: number; data: Float32Array }) {
  const { frames, data } = f
  for (let b = 0; b < FBANK_BINS; b++) {
    let s = 0
    for (let m = 0; m < frames; m++) s += data[m * FBANK_BINS + b]
    const mean = s / frames
    let v = 0
    for (let m = 0; m < frames; m++) v += (data[m * FBANK_BINS + b] - mean) ** 2
    const sd = Math.sqrt(v / frames) + 1e-5
    for (let m = 0; m < frames; m++) data[m * FBANK_BINS + b] = (data[m * FBANK_BINS + b] - mean) / sd
  }
}
