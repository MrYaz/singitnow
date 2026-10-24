/// <reference lib="webworker" />
import { ANALYSIS_RATE, compactActivity, computeActivity, sungSpans } from './activity'
import { findBeats } from './beats'

self.onmessage = (e: MessageEvent<{ voice?: Float32Array; music: Float32Array }>) => {
  if (!e.data.voice) {
    self.postMessage({ beats: findBeats(e.data.music, ANALYSIS_RATE) })
    return
  }
  const act = computeActivity(e.data.voice, e.data.music)
  self.postMessage({ spans: sungSpans(act), activity: compactActivity(act) })
}
