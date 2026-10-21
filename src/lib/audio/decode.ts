/** Decodes an audio file and resamples it to mono at `rate` Hz. */
export async function decodeMono(blob: Blob, rate: number): Promise<{ pcm: Float32Array; duration: number }> {
  const data = await blob.arrayBuffer()
  const decoder = new OfflineAudioContext(1, 1, 44100)
  const buf = await decoder.decodeAudioData(data)
  const length = Math.max(1, Math.ceil(buf.duration * rate))
  const ctx = new OfflineAudioContext(1, length, rate)
  const src = ctx.createBufferSource()
  src.buffer = buf
  src.connect(ctx.destination)
  src.start()
  const out = await ctx.startRendering()
  return { pcm: out.getChannelData(0), duration: buf.duration }
}
