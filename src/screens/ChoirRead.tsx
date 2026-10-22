import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/db'
import { pickVoice, sortVoices } from '../lib/names'
import { useNav } from '../nav'
import { useSettings } from '../settings'
import { keepAwake } from '../lib/wakelock'
import { withAllVoices } from '../lib/merge'
import { LineText, OthersText, TopBar, othersVoices } from '../components/ui'

const SIZES = [12, 14, 16, 18, 21, 24, 28, 32, 38, 44]
const SIZE_KEY = 'singitnow.readSize'

function savedSize(): number {
  try {
    const n = Number(localStorage.getItem(SIZE_KEY))
    return SIZES.includes(n) ? n : 24
  } catch {
    return 24
  }
}

const clock = (s: number | null) => (s === null ? '' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`)

/** Körrep: just the lyrics, large and calm, for reading at rehearsal on a phone or tablet. */
export default function ChoirRead({ songId }: { songId: string }) {
  const nav = useNav()
  const { settings } = useSettings()
  const songs = useLiveQuery(() => db.songs.orderBy('order').toArray(), [])
  const song = songs?.find((s) => s.id === songId)
  const [voice, setVoice] = useState<string | null>(null)
  const [size, setSize] = useState(savedSize)

  // Keep the screen on while the lyrics are open.
  useEffect(() => keepAwake(), [])

  const changeSize = (dir: 1 | -1) => {
    const i = Math.min(SIZES.length - 1, Math.max(0, SIZES.indexOf(size) + dir))
    setSize(SIZES[i])
    try {
      localStorage.setItem(SIZE_KEY, String(SIZES[i]))
    } catch {
      /* private mode */
    }
  }

  if (!songs || !song) return null
  const voices = sortVoices(Object.keys(song.voices))
  const shown = voice && song.voices[voice] ? voice : (pickVoice(song.voices, settings.voices) ?? voices[0])
  const at = songs.indexOf(song)
  const prev = songs[at - 1]
  const next = songs[at + 1]
  const sizeBtn = 'grid h-11 w-11 place-items-center rounded-full bg-brand-100 font-black text-brand-700 active:bg-brand-200 disabled:opacity-40'

  return (
    <>
      <TopBar
        title="Körrep"
        right={
          <div className="flex gap-1.5">
            <button aria-label="Mindre text" className={`${sizeBtn} text-sm`} disabled={size === SIZES[0]} onClick={() => changeSize(-1)}>
              A−
            </button>
            <button aria-label="Större text" className={`${sizeBtn} text-xl`} disabled={size === SIZES.at(-1)} onClick={() => changeSize(1)}>
              A+
            </button>
          </div>
        }
      />
      <main className="w-full px-3 pb-12 sm:px-6">
        <h2 className="mt-2 text-3xl leading-tight font-black">{song.title}</h2>
        {voices.length > 1 && (
          <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Stämma">
            {voices.map((v) => (
              <button
                key={v}
                aria-pressed={v === shown}
                className={`rounded-full px-4 py-2 text-base font-extrabold ${v === shown ? 'bg-brand-600 text-white' : 'bg-brand-100 text-brand-700'}`}
                onClick={() => setVoice(v)}
              >
                {v}
              </button>
            ))}
          </div>
        )}
        <p className="mt-3 text-base text-gray-600">
          <span className="harmony">Markerat</span> = stämsång. <span className="italic">Kursivt</span> = ekon och bakgrund. <span className="text-gray-500 italic">Grått</span> = de andra stämmorna.
        </p>

        <div className="mt-6 space-y-8" style={{ fontSize: size, lineHeight: 1.5 }}>
          {withAllVoices(song, shown).map((s, i) => {
            const who = othersVoices(s.others)
            return (
              <section key={i} className="border-l-2 border-brand-100 pl-2.5 sm:border-l-4 sm:pl-4">
                <p className="mb-1 text-sm font-black tracking-wide text-brand-600 uppercase">
                  {clock(s.pdfStart)}
                  {s.rest && <span className="ml-2 font-bold text-gray-500 normal-case">tyst{who.length > 0 && ` (${who.join(', ')})`}</span>}
                </p>
                {s.note && <p className="mb-1 text-[0.75em] text-gray-600 italic">{s.note}</p>}
                {s.lines.map((l, k) => (
                  <p key={k} className="text-gray-900">
                    <LineText line={l} />
                  </p>
                ))}
                {s.others.length > 0 && <OthersText others={s.others} labels={s.lines.length > 0} className={`text-gray-500 ${s.lines.length ? 'mt-2 text-[0.8em]' : ''}`} />}
              </section>
            )
          })}
        </div>

        <div className="mt-10 flex gap-3">
          {prev && (
            <button className="btn-soft flex-1 py-3 text-base" onClick={() => nav.replace({ name: 'read', songId: prev.id })}>
              ‹ {prev.title}
            </button>
          )}
          {next && (
            <button className="btn-soft flex-1 py-3 text-base" onClick={() => nav.replace({ name: 'read', songId: next.id })}>
              {next.title} ›
            </button>
          )}
        </div>
      </main>
    </>
  )
}
