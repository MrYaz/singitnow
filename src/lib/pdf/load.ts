import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { extractPdf } from './extract'
import { parseLyrics } from './parseLyrics'
import type { ParsedLyrics } from '../types'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export async function readLyricsPdf(blob: Blob): Promise<ParsedLyrics> {
  const data = new Uint8Array(await blob.arrayBuffer())
  const doc = await pdfjs.getDocument({ data }).promise
  try {
    return parseLyrics(await extractPdf(doc, pdfjs.OPS as unknown as Record<string, number>))
  } finally {
    doc.destroy()
  }
}
