import type { ReactNode } from 'react'
import type { Line } from '../lib/types'
import { useNav } from '../nav'

export function TopBar({ title, right, onBack }: { title?: ReactNode; right?: ReactNode; onBack?: () => void }) {
  const nav = useNav()
  return (
    <header className="sticky top-0 z-10 flex items-center gap-2 bg-[#faf7ff]/95 px-3 pt-[max(env(safe-area-inset-top),12px)] pb-2 backdrop-blur">
      <button aria-label="Tillbaka" className="grid h-10 w-10 place-items-center rounded-full text-2xl text-brand-700 active:bg-brand-100" onClick={onBack ?? nav.back}>
        ‹
      </button>
      <h1 className="min-w-0 flex-1 truncate text-lg font-extrabold">{title}</h1>
      {right}
    </header>
  )
}

export function Bar({ value, className = '' }: { value: number; className?: string }) {
  return (
    <div className={`h-3 overflow-hidden rounded-full bg-brand-100 ${className}`}>
      <div className="h-full rounded-full bg-brand-500 transition-all duration-500" style={{ width: `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%` }} />
    </div>
  )
}

/** A lyric line with stämsång parts highlighted the way the PDFs do it. */
export function LineText({ line, className = '' }: { line: Line; className?: string }) {
  return (
    <span className={className}>
      {line.segs.map((s, i) => (
        <span key={i} className={`${s.harmony ? 'harmony' : ''} ${s.adlib ? 'italic opacity-75' : ''}`}>
          {i > 0 && !/^[,.!?;:]/.test(s.text) ? ' ' : ''}
          {s.text}
        </span>
      ))}
    </span>
  )
}

const LABEL = /^([\p{L}\d ]{1,12}):\s*(.*)$/u
const VOICE_NAMES: Record<string, string> = {
  sop: 'Sopraner', sopran: 'Sopraner', s: 'Sopraner', s1: 'Sopran 1', s2: 'Sopran 2',
  alt: 'Altar', a: 'Altar', alt1: 'Alt 1', a1: 'Alt 1', alt2: 'Alt 2', a2: 'Alt 2',
  alla: 'Alla', solist: 'Solist',
}

/** Full names of the voices that sing while yours rests, from labels like "Sop:" in the PDF. */
export function othersVoices(others: string[]): string[] {
  const out: string[] = []
  for (const o of others) {
    const m = o.match(LABEL)
    if (!m) continue
    const key = m[1].toLowerCase().replace(/\s+/g, '')
    const name = VOICE_NAMES[key] ?? m[1].trim()
    if (!out.includes(name)) out.push(name)
  }
  return out
}

/** What the other voices sing while yours rests: italic and greyed out.
 *  With one voice the name sits in the card heading, so labels are only shown when several voices alternate. */
export function OthersText({ others }: { others: string[] }) {
  const showLabels = othersVoices(others).length > 1
  return (
    <div className="space-y-0.5 px-1 text-lg text-gray-400 italic">
      {others.map((o, i) => {
        const m = o.match(LABEL)
        return (
          <p key={i}>
            {m && showLabels && <span className="mr-1 text-xs font-bold not-italic">({othersVoices([o])[0]})</span>}
            {m ? m[2] : o}
          </p>
        )
      })}
    </div>
  )
}

export function Sheet({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/30" onClick={onClose}>
      <div className="pop w-full max-w-xl rounded-t-3xl bg-white p-5 pb-[max(env(safe-area-inset-bottom),20px)]" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}

export const fmt = (t: number | undefined) => {
  if (t === undefined || Number.isNaN(t)) return '–'
  const m = Math.floor(t / 60)
  const s = t - m * 60
  return `${m}:${s.toFixed(1).padStart(4, '0')}`
}

export const crown = (done: boolean) => (done ? '👑' : '')
