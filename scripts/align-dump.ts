// Dev helper: npx vite-node scripts/align-dump.ts <song folder> <out.json>
// Runs the in-app analysis on every voice of a song (needs ffmpeg) and writes line timings.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { extractPdf } from '../src/lib/pdf/extract'
import { parseLyrics } from '../src/lib/pdf/parseLyrics'
import { ANALYSIS_RATE, computeActivity, sungSpans } from '../src/lib/audio/activity'
import { alignLyrics } from '../src/lib/audio/align'
import { classify } from '../src/lib/names'

const decode = (p: string) => {
  const b = execFileSync('ffmpeg', ['-v', 'error', '-i', p, '-ac', '1', '-ar', String(ANALYSIS_RATE), '-f', 'f32le', '-'], { maxBuffer: 1 << 30 })
  return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4)
}
const [dir, out] = process.argv.slice(2)
const files = readdirSync(dir)
const textDir = `${dir}/${files.find((f) => f.toLowerCase() === 'text')}`
const pdfs = readdirSync(textDir)
const musikName = files.find((f) => classify(f)?.kind === 'musik')!
const music = decode(`${dir}/${musikName}`)
const res: Record<string, unknown> = {}
for (const f of files) {
  const c = classify(f)
  if (c?.kind !== 'voice') continue
  const pdf = pdfs.find((p) => classify(p)?.voice === c.voice)
  if (!pdf) continue
  const voice = decode(`${dir}/${f}`)
  const act = computeActivity(voice, music)
  const spans = sungSpans(act)
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(`${textDir}/${pdf}`)) }).promise
  const parsed = parseLyrics(await extractPdf(doc, pdfjs.OPS as unknown as Record<string, number>))
  const secs = alignLyrics(parsed, spans, voice.length / ANALYSIS_RATE)
  res[c.voice!] = { file: f.replace(/\.mp3$/, ''), sections: secs, spans, activity: Array.from(act, (v) => Math.round(v * 1000) / 1000) }
}
writeFileSync(out, JSON.stringify(res))
