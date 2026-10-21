// Dev helper: npx vite-node scripts/dump-lyrics.ts <pdf>
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { readFileSync } from 'node:fs'
import { extractPdf } from '../src/lib/pdf/extract'
import { parseLyrics } from '../src/lib/pdf/parseLyrics'

const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(process.argv[2])) }).promise
const res = parseLyrics(await extractPdf(doc, pdfjs.OPS as unknown as Record<string, number>))
console.log('TITLE:', res.title)
for (const s of res.sections) {
  console.log(s.pdfStart, s.pdfEnd ?? '', s.rest ? 'TYST' : '', s.note ? `NOTE: ${s.note}` : '')
  for (const l of s.lines) console.log('   ', l.harmony ? '[H]' : '   ', l.adlib ? '(ad)' : '    ', l.segs.map((g) => (g.harmony ? `<${g.text}>` : g.text)).join(' | '))
  for (const o of s.others) console.log('        >>', o)
}
