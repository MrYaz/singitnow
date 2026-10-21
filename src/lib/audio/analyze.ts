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
