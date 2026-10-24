import type { Span } from './activity'
import { ANALYSIS_RATE } from './activity'
import { decodeMono } from './decode'

export interface AnalysisResult {
  spans: Span[]
  activity: number[]
}

/** Runs the heavy part in a worker so the app stays responsive. */
export function analyzeInWorker(voice: Float32Array, music: Float32Array): Promise<AnalysisResult> {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (e) => {
      resolve(e.data as AnalysisResult)
      w.terminate()
    }
    w.onerror = (e) => {
      reject(new Error(e.message || 'Analysen misslyckades'))
      w.terminate()
    }
    // Copy so the caller can reuse the backing track for the next voice.
    const v = voice.slice()
    const m = music.slice()
    w.postMessage({ voice: v, music: m }, [v.buffer, m.buffer])
  })
}

export const decodeForAnalysis = (blob: Blob) => decodeMono(blob, ANALYSIS_RATE)

export interface CtcOutput {
  lp: Float32Array
  frames: number
  vocab: number
}

let tokens: Promise<string[]> | null = null

export const modelUrl = (name: string) => `${import.meta.env.BASE_URL}models/${name}`

export function loadTokens(): Promise<string[]> {
  tokens ??= fetch(modelUrl('ctc-en-small.tokens.json')).then((r) => {
    if (!r.ok) throw new Error('Kunde inte hämta talmodellen')
    return r.json() as Promise<string[]>
  })
  return tokens
}

let queue: Promise<unknown> = Promise.resolve()

/**
 * Runs the speech model and returns log-probabilities per 40 ms frame.
 * The voice is cut into overlapping windows and only the middle of each is kept. The windows are
 * spread over several workers, one per spare core, which gives the very same result as one
 * worker, only faster. Workers stay alive between voices, so the model loads once in each.
 * onProgress gets the share done, and while the model itself loads, how far that has come.
 */
export function runSpeechModel(pcm: Float32Array, spans: [number, number][], onProgress?: (share: number, loading?: number) => void): Promise<CtcOutput> {
  const job = queue.then(() => runNow(pcm, spans, onProgress))
  queue = job.catch(() => {})
  return job
}

const SR = 16000
const WIN = 20
const OVERLAP = 3
const FRAMES_PER_SEC = 25

/** One per spare core, at most three: each holds its own copy of the model in memory. */
function poolSize(): number {
  const cores = navigator.hardwareConcurrency || 2
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory
  const n = Math.max(1, Math.min(3, cores - 1))
  return memory && memory < 3 ? Math.min(n, 2) : n
}

let pool: Worker[] = []

/** Puts the speech model in the cache the workers read it from, reporting how far the download has come. */
async function cacheModel(onLoading: (share: number) => void): Promise<void> {
  const url = modelUrl('ctc-en-small.int8.onnx')
  try {
    const cache = await caches.open('singitnow-models')
    if (await cache.match(url)) return
    const res = await fetch(url)
    if (!res.ok || !res.body) return
    // May be the compressed size, so the share is only a guide.
    const total = Number(res.headers.get('content-length') ?? 0)
    const chunks: Uint8Array[] = []
    const reader = res.body.getReader()
    let got = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      got += value.length
      if (total) onLoading(Math.min(0.99, got / total))
    }
    await cache.put(url, new Response(new Blob(chunks as BlobPart[]), { headers: { 'content-type': 'application/octet-stream' } }))
    onLoading(1)
  } catch {
    /* no Cache API (private mode): the workers download it themselves */
  }
}
let nextId = 0

async function runNow(pcm: Float32Array, spans: [number, number][], onProgress?: (share: number, loading?: number) => void): Promise<CtcOutput> {
  const dur = pcm.length / SR
  const total = Math.ceil(dur * FRAMES_PER_SEC)
  const sings = (a: number, b: number) => spans.some(([s0, s1]) => s1 > a && s0 < b)
  const windows: { t: number; a: number; b: number; run: boolean }[] = []
  for (let t = 0; t < dur; t += WIN) {
    const a = Math.max(0, t - OVERLAP)
    const b = Math.min(dur, t + WIN + OVERLAP)
    windows.push({ t, a, b, run: sings(a, b) })
  }
  // The first window always runs, to learn the size of the model's output.
  if (windows.length) windows[0].run = true
  const todo = windows.map((w, i) => (w.run ? i : -1)).filter((i) => i >= 0)

  // Download the model once, here, so the workers all find it in the cache instead of each downloading it.
  if (!pool.length) {
    await cacheModel((share) => onProgress?.(0, share))
    // Each worker now loads the model, which takes a while before the first window is done.
    onProgress?.(0, 0)
    pool = Array.from({ length: poolSize() }, () => new Worker(new URL('./ctcWorker.ts', import.meta.url), { type: 'module' }))
  }
  const results = new Map<number, { data: Float32Array; n: number; V: number }>()
  let done = 0
  let next = 0
  const url = modelUrl('ctc-en-small.int8.onnx')

  // Each worker takes the next window as soon as it is free.
  const work = (w: Worker) =>
    new Promise<void>((resolve, reject) => {
      let current = -1
      const take = () => {
        if (next >= todo.length) return resolve()
        current = todo[next++]
        const win = windows[current]
        const seg = pcm.slice(Math.floor(win.a * SR), Math.floor(win.b * SR))
        w.postMessage({ id: ++nextId, modelUrl: url, pcm: seg }, [seg.buffer])
      }
      w.onmessage = (e) => {
        const d = e.data
        if (d.error) return reject(new Error(d.error))
        results.set(current, { data: d.data, n: d.n, V: d.V })
        onProgress?.(++done / todo.length)
        take()
      }
      w.onerror = (e) => reject(new Error(e.message || 'Talmodellen misslyckades'))
      take()
    })
  try {
    await Promise.all(pool.slice(0, Math.max(1, Math.min(pool.length, todo.length))).map(work))
  } catch (err) {
    stopSpeechModel()
    throw err
  }

  // Put the windows together in order, as one worker would have.
  const V = results.values().next().value!.V
  const res = new Float32Array((total + 50) * V)
  let filled = 0
  windows.forEach((win, i) => {
    const g = Math.round(win.t * FRAMES_PER_SEC)
    const r = results.get(i)
    if (!r) {
      // Nobody sings here: silence, without running the model.
      const n = Math.round(Math.min(WIN, dur - win.t) * FRAMES_PER_SEC)
      for (let f = g; f < g + n; f++) {
        res.fill(-30, f * V, (f + 1) * V)
        res[f * V + V - 1] = 0
      }
      filled = g + n
      return
    }
    const s = Math.round((win.t - win.a) * FRAMES_PER_SEC)
    const e2 = Math.min(r.n, s + Math.round(Math.min(WIN, dur - win.t) * FRAMES_PER_SEC))
    res.set(r.data.subarray(s * V, e2 * V), g * V)
    filled = g + (e2 - s)
  })
  return { lp: res.slice(0, filled * V), frames: filled, vocab: V }
}

export function stopSpeechModel() {
  pool.forEach((w) => w.terminate())
  pool = []
}
