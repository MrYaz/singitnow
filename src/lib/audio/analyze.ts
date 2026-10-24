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

let ctcWorker: Worker | null = null
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
 * Runs the speech model in a worker that stays alive between voices, so the model loads once.
 * Calls wait for each other, since the worker handles one file at a time.
 */
/** onProgress gets the share done, and while the model itself loads, how far that has come. */
export function runSpeechModel(pcm: Float32Array, spans: [number, number][], onProgress?: (share: number, loading?: number) => void): Promise<CtcOutput> {
  const job = queue.then(() => runNow(pcm, spans, onProgress))
  queue = job.catch(() => {})
  return job
}

function runNow(pcm: Float32Array, spans: [number, number][], onProgress?: (share: number, loading?: number) => void): Promise<CtcOutput> {
  ctcWorker ??= new Worker(new URL('./ctcWorker.ts', import.meta.url), { type: 'module' })
  const w = ctcWorker
  return new Promise((resolve, reject) => {
    w.onmessage = (e) => {
      const d = e.data
      if (d.progress !== undefined) onProgress?.(d.progress, d.loading)
      else if (d.error) reject(new Error(d.error))
      else resolve(d as CtcOutput)
    }
    w.onerror = (e) => {
      reject(new Error(e.message || 'Talmodellen misslyckades'))
      w.terminate()
      ctcWorker = null
    }
    const copy = pcm.slice()
    w.postMessage({ modelUrl: modelUrl('ctc-en-small.int8.onnx'), pcm: copy, spans }, [copy.buffer])
  })
}

export function stopSpeechModel() {
  ctcWorker?.terminate()
  ctcWorker = null
}
