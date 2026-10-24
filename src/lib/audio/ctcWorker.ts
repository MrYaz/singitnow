/// <reference lib="webworker" />
import * as ort from 'onnxruntime-web/wasm'
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url'
import { FBANK_BINS, fbank, normalizeFeatures } from './fbank'

ort.env.wasm.wasmPaths = { wasm: wasmUrl }
ort.env.wasm.numThreads = 1

let session: Promise<ort.InferenceSession> | null = null

async function download(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Kunde inte hämta talmodellen (${res.status})`)
  return res.arrayBuffer()
}

async function loadModel(url: string): Promise<ArrayBuffer> {
  try {
    const cache = await caches.open('singitnow-models')
    const hit = await cache.match(url)
    if (hit) return hit.arrayBuffer()
    const buf = await download(url)
    await cache.put(url, new Response(buf.slice(0)))
    return buf
  } catch {
    return download(url)
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

/**
 * Runs the model on one window of audio. The page cuts the voice into windows and spreads them
 * over several of these workers, one per core, then puts the results together (see analyze.ts).
 */
self.onmessage = async (e: MessageEvent<{ id: number; modelUrl: string; pcm: Float32Array }>) => {
  const { id } = e.data
  try {
    session ??= loadModel(e.data.modelUrl).then((buf) => ort.InferenceSession.create(buf, { executionProviders: ['wasm'] }))
    const out = await run(e.data.pcm)
    const [, n, V] = out.dims as number[]
    const data = (out.data as Float32Array).slice()
    self.postMessage({ id, data, n, V }, [data.buffer])
  } catch (err) {
    // A failed load is tried again with the next window.
    session = null
    self.postMessage({ id, error: err instanceof Error ? err.message : String(err) })
  }
}
