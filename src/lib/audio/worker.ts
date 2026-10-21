/// <reference lib="webworker" />
import { compactActivity, computeActivity, sungSpans } from './activity'

self.onmessage = (e: MessageEvent<{ voice: Float32Array; music: Float32Array }>) => {
  const act = computeActivity(e.data.voice, e.data.music)
  self.postMessage({ spans: sungSpans(act), activity: compactActivity(act) })
}
