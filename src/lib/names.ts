import type { TrackKind } from './types'

/** Canonical voice names used across the app. */
export const VOICE_ORDER = ['Sopran', 'Sopran 1', 'Sopran 2', 'Alt 1', 'Alt 2']

export function voiceFromName(name: string): string | null {
  const m = name.toLowerCase().match(/(sopran ?[12]?|sop ?[12]?|alt ?[12]|a[12])(?![\p{L}])/u)
  if (!m) return null
  const k = m[1].replace(/\s/g, '')
  const map: Record<string, string> = {
    sopran: 'Sopran',
    sop: 'Sopran',
    sopran1: 'Sopran 1',
    sop1: 'Sopran 1',
    sopran2: 'Sopran 2',
    sop2: 'Sopran 2',
    alt1: 'Alt 1',
    a1: 'Alt 1',
    alt2: 'Alt 2',
    a2: 'Alt 2',
  }
  return map[k] ?? null
}

export function classify(name: string): { kind: TrackKind; voice?: string } | null {
  const lower = name.toLowerCase()
  if (lower.endsWith('.pdf')) {
    const voice = voiceFromName(name)
    return voice ? { kind: 'pdf', voice } : null
  }
  if (!/\.(mp3|m4a|wav|aac|ogg)$/.test(lower)) return null
  const base = lower.trim()
  if (base.startsWith('alla')) return { kind: 'alla' }
  if (base.startsWith('musik')) return { kind: 'musik' }
  if (base.startsWith('solist')) return { kind: 'solo' }
  const voice = voiceFromName(name)
  return voice ? { kind: 'voice', voice } : null
}

/** "Alt 2 - Why did it have to be me.mp3" -> "why did it have to be me" */
export function songNameFromFile(name: string): string {
  return name
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/^(alla|musik|solistdel)\s*[-–]\s*/i, '')
    .replace(/(sopran ?[12]?|sop ?[12]?|alt ?[12]|a[12])(?![\p{L}])\s*[-–]?\s*/iu, '')
    .replace(/\s*[-–]\s*$/, '')
    .trim()
}

export const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/&/g, 'n')
    .replace(/[^\p{L}\p{N}]/gu, '')

/** Dice similarity on letter pairs, 0..1. */
export function similarity(a: string, b: string): number {
  const pairs = (s: string) => {
    const n = normalize(s)
    const out = new Map<string, number>()
    for (let i = 0; i + 1 < n.length; i++) out.set(n.slice(i, i + 2), (out.get(n.slice(i, i + 2)) ?? 0) + 1)
    return out
  }
  const pa = pairs(a)
  const pb = pairs(b)
  let both = 0
  let total = 0
  for (const [k, v] of pa) {
    both += Math.min(v, pb.get(k) ?? 0)
    total += v
  }
  for (const v of pb.values()) total += v
  return total ? (2 * both) / total : 0
}

export const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

export function sortVoices(vs: string[]): string[] {
  return [...vs].sort((a, b) => VOICE_ORDER.indexOf(a) - VOICE_ORDER.indexOf(b))
}

/** Short labels for solo buttons: S, S1, S2, A1, A2. */
export const shortVoice = (v: string) =>
  ({ Sopran: 'S', 'Sopran 1': 'S1', 'Sopran 2': 'S2', 'Alt 1': 'A1', 'Alt 2': 'A2' })[v] ?? v
