/// <reference lib="webworker" />
import * as ort from 'onnxruntime-web/wasm'
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url'
import { FBANK_BINS, fbank, normalizeFeatures } from './fbank'

/**
 * Runs the speech model on a voice file and returns log-probabilities per 40 ms frame.
 * Long files are cut into overlapping windows; only the middle of each window is kept.
 */
const SR = 16000
const WIN = 20
const OVERLAP = 3
const FRAMES_PER_SEC = 25

ort.env.wasm.wasmPaths = { wasm: wasmUrl }
ort.env.wasm.numThreads = 1

let session: Promise<ort.InferenceSession> | null = null

async function loadModel(url: string): Promise<ArrayBuffer> {
  try {
    const cache = await caches.open('singitnow-models')
    const hit = await cache.match(url)
    if (hit) return hit.arrayBuffer()
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Kunde inte hämta talmodellen (${res.status})`)
    await cache.put(url, res.clone())
    return res.arrayBuffer()
  } catch {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Kunde inte hämta talmodellen (${res.status})`)
    return res.arrayBuffer()
  }
}

async function run(pcm: Float32Array): Promise<ort.Tensor> {
  const s = await session!
  const f = fbank(pcm)
  normalizeFeatures(f)
  // The model wants [1, 80, frames].
  const x = new Float32Array(FBANK_BINS * f.frames)
  for (let m = 0; m < f.frames; m++) for (let b = 0; b < FBANK_BINS; b++) x[b * f.frames + m] = f.data[m * FBANK_BINS + b]
  const out = await s.run({
    audio_signal: new ort.Tensor('float32', x, [1, FBANK_BINS, f.frames]),
    length: new ort.Tensor('int64', BigInt64Array.from([BigInt(f.frames)]), [1]),
  })
  return out[s.outputNames[0]]
}

self.onmessage = async (e: MessageEvent<{ modelUrl: string; pcm: Float32Array; spans: [number, number][] }>) => {
  try {
    session ??= loadModel(e.data.modelUrl).then((buf) => ort.InferenceSession.create(buf, { executionProviders: ['wasm'] }))
    const pcm = e.data.pcm
    const dur = pcm.length / SR
    const total = Math.ceil(dur * FRAMES_PER_SEC)
    let vocab = 0
    let res: Float32Array | null = null
    let filled = 0
    const sings = (a: number, b: number) => e.data.spans.some(([s0, s1]) => s1 > a && s0 < b)
    for (let t = 0; t < dur; t += WIN) {
      const a = Math.max(0, t - OVERLAP)
      const b = Math.min(dur, t + WIN + OVERLAP)
      if (vocab && !sings(a, b)) {
        // Nobody sings here: mark the window as silence without running the model.
        const g = Math.round(t * FRAMES_PER_SEC)
        const n = Math.round(Math.min(WIN, dur - t) * FRAMES_PER_SEC)
        for (let f = g; f < g + n; f++) {
          res!.fill(-30, f * vocab, (f + 1) * vocab)
          res![f * vocab + vocab - 1] = 0
        }
        filled = g + n
        continue
      }
      const out = await run(pcm.subarray(Math.floor(a * SR), Math.floor(b * SR)))
      const [, n, V] = out.dims as number[]
      vocab = V
      res ??= new Float32Array((total + 50) * V)
      const s = Math.round((t - a) * FRAMES_PER_SEC)
      const e2 = Math.min(n, s + Math.round(Math.min(WIN, dur - t) * FRAMES_PER_SEC))
      const g = Math.round(t * FRAMES_PER_SEC)
      res.set((out.data as Float32Array).subarray(s * V, e2 * V), g * V)
      filled = g + (e2 - s)
      self.postMessage({ progress: Math.min(1, (t + WIN) / dur) })
    }
    const lp = res!.slice(0, filled * vocab)
    self.postMessage({ lp, frames: filled, vocab }, [lp.buffer])
  } catch (err) {
    self.postMessage({ error: err instanceof Error ? err.message : String(err) })
  }
}
