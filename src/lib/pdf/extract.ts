/**
 * Pulls positioned text and filled rectangles (highlights) out of a PDF with pdf.js.
 * Works both in the browser and in Node (tests), so pdf.js is passed in.
 */
export interface PdfText {
  str: string
  x: number
  /** Baseline, PDF user space (y grows upwards). */
  y: number
  w: number
  size: number
  italic: boolean
  bold: boolean
}

export interface PdfRect {
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface PdfPage {
  texts: PdfText[]
  highlights: PdfRect[]
}

type Matrix = [number, number, number, number, number, number]

const mul = (m: Matrix, c: Matrix): Matrix => [
  m[0] * c[0] + m[1] * c[2],
  m[0] * c[1] + m[1] * c[3],
  m[2] * c[0] + m[3] * c[2],
  m[2] * c[1] + m[3] * c[3],
  m[4] * c[0] + m[5] * c[2] + c[4],
  m[4] * c[1] + m[5] * c[3] + c[5],
]
const apply = (c: Matrix, x: number, y: number): [number, number] => [
  c[0] * x + c[2] * y + c[4],
  c[1] * x + c[3] * y + c[5],
]

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function extractPdf(doc: any, OPS: Record<string, number>): Promise<PdfPage[]> {
  const pages: PdfPage[] = []
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p)
    const ol = await page.getOperatorList()
    const highlights: PdfRect[] = []
    let ctm: Matrix = [1, 0, 0, 1, 0, 0]
    const stack: Matrix[] = []
    let fill: [number, number, number] = [0, 0, 0]
    let path: number[] | null = null
    for (let i = 0; i < ol.fnArray.length; i++) {
      const fn = ol.fnArray[i]
      const args = ol.argsArray[i]
      if (fn === OPS.save) stack.push(ctm)
      else if (fn === OPS.restore) ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0]
      else if (fn === OPS.transform) ctm = mul(args as Matrix, ctm)
      else if (fn === OPS.setFillRGBColor) {
        const a = args as ArrayLike<number> | string
        if (typeof a === 'string') {
          const n = parseInt(a.replace('#', ''), 16)
          fill = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
        } else fill = [a[0], a[1], a[2]]
      } else if (fn === OPS.constructPath) {
        const mm = args?.[2]
        path = mm && mm.length >= 4 ? [mm[0], mm[1], mm[2], mm[3]] : null
      } else if ((fn === OPS.fill || fn === OPS.eoFill) && path) {
        const white = fill[0] > 245 && fill[1] > 245 && fill[2] > 245
        const grey = Math.max(...fill) - Math.min(...fill) < 12
        if (!white && !grey) {
          const [ax, ay] = apply(ctm, path[0], path[1])
          const [bx, by] = apply(ctm, path[2], path[3])
          highlights.push({ x0: Math.min(ax, bx), y0: Math.min(ay, by), x1: Math.max(ax, bx), y1: Math.max(ay, by) })
        }
        path = null
      }
    }
    const tc = await page.getTextContent()
    const texts: PdfText[] = []
    for (const it of tc.items as any[]) {
      if (!it.str) continue
      let fontName = ''
      try {
        fontName = page.commonObjs.get(it.fontName)?.name ?? ''
      } catch {
        fontName = ''
      }
      const t = it.transform as number[]
      texts.push({
        str: it.str,
        x: t[4],
        y: t[5],
        w: it.width,
        size: Math.abs(t[3]) || Math.abs(t[0]),
        italic: /italic|oblique/i.test(fontName),
        bold: /bold/i.test(fontName),
      })
    }
    pages.push({ texts, highlights })
  }
  return pages
}
