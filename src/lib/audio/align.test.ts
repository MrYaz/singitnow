import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { extractPdf } from '../pdf/extract'
import { parseLyrics } from '../pdf/parseLyrics'
import { ANALYSIS_RATE, computeActivity, sungSpans } from './activity'
import { alignLyrics } from './align'

// Real choir material is not in the repo (it is Sing It's). Point MATERIAL_DIR at a local copy to run.
const DIR = process.env.MATERIAL_DIR ?? '/mnt/project-files/HT26 Piteå'
const has = existsSync(DIR)

function decode(path: string): Float32Array {
  const buf = execFileSync('ffmpeg', ['-v', 'error', '-i', path, '-ac', '1', '-ar', String(ANALYSIS_RATE), '-f', 'f32le', '-'], {
    maxBuffer: 1 << 30,
  })
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4)
}

async function lyrics(path: string) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(path)) }).promise
  return parseLyrics(await extractPdf(doc, pdfjs.OPS as unknown as Record<string, number>))
}

describe.skipIf(!has)('alignment on real material', () => {
  it('finds the lines of "Why did it have to be me", Alt 2', async () => {
    const song = `${DIR}/1. Why did it have to be me`
    const voice = decode(`${song}/Alt 2 - Why did it have to be me.mp3`)
    const music = decode(`${song}/Musik - Why did it have to be me.mp3`)
    const act = computeActivity(voice, music)
    const spans = sungSpans(act)
    const parsed = await lyrics(`${song}/Text/Alt 2 - Why did it have to be me.pdf`)
    const secs = alignLyrics(parsed, spans, voice.length / ANALYSIS_RATE)
    const first = secs.find((s) => s.lines.length)!
    // Matches the reference analysis: the voice enters at about 9.0 s.
    expect(first.start).toBeGreaterThan(8.5)
    expect(first.start).toBeLessThan(9.5)
    expect(first.lines[0].end).toBeGreaterThan(12)
    const men = secs.find((s) => s.lines[0]?.text.startsWith('Men are the toys'))!
    expect(Math.abs(men.start! - 91.2)).toBeLessThan(0.6)
    for (const s of secs) for (const l of s.lines) expect(l.end! >= l.start!).toBe(true)
  }, 120_000)
})
