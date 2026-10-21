import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/db'
import { levelsFor } from '../lib/learn'
import { LEVELS, buildLesson, learnable } from '../lib/exercises'
import { useNav } from '../nav'
import { useSettings } from '../settings'
import { LineText, Sheet, TopBar } from '../components/ui'

export default function SongPath({ songId }: { songId: string }) {
  const nav = useNav()
  const { settings } = useSettings()
  const voice = settings.voice!
  const song = useLiveQuery(() => db.songs.get(songId), [songId])
  const levels = useLiveQuery(() => levelsFor(songId, voice), [songId, voice])
  const [open, setOpen] = useState<number | null>(null)
  if (!song || !levels) return null
  const track = song.voices[voice]
  if (!track) {
    return (
      <>
        <TopBar title={song.title} />
        <p className="p-4">Låten har ingen {voice}-stämma.</p>
      </>
    )
  }
  const secs = learnable(track.sections)
  const nextIdx = secs.find((x) => (levels[x.i] ?? 0) < LEVELS.length)?.i
  const allDone = nextIdx === undefined

  const start = (section: number, level: number) => {
    setOpen(null)
    nav.go({
      name: 'lesson',
      title: `${song.title} · ${LEVELS[level].name}`,
      items: buildLesson(track.sections, section, level).map((ex) => ({ songId, voice, ex })),
      level: { songId, voice, section, level },
    })
  }

  const openSec = open !== null ? track.sections[open] : null
  const openLevel = open !== null ? Math.min(levels[open] ?? 0, LEVELS.length - 1) : 0

  return (
    <>
      <TopBar
        title={song.title}
        right={
          <button className="rounded-full bg-brand-100 px-3 py-1.5 text-sm font-extrabold text-brand-700" onClick={() => nav.go({ name: 'rehearsal', songId })}>
            Stämrep
          </button>
        }
      />
      <main className="px-4 pb-16">
        <p className="mb-6 text-center text-sm text-gray-500">
          {voice} · en formdel i taget, {LEVELS.length} steg per del
        </p>
        <ol className="relative mx-auto flex max-w-sm flex-col items-center gap-6">
          {secs.map(({ s, i }, k) => {
            const lv = levels[i] ?? 0
            const done = lv >= LEVELS.length
            const isNext = i === nextIdx
            const offset = ['translate-x-0', 'translate-x-12', 'translate-x-0', '-translate-x-12'][k % 4]
            return (
              <li key={i} className={`flex flex-col items-center ${offset}`}>
                <button
                  aria-label={`Del ${k + 1}`}
                  onClick={() => setOpen(i)}
                  className={`relative grid h-20 w-20 place-items-center rounded-full text-3xl font-black transition active:translate-y-1 ${
                    done
                      ? 'bg-warm-500 text-white shadow-[0_6px_0_#b45309]'
                      : isNext
                        ? 'bg-brand-600 text-white shadow-[0_6px_0_#4c1d95] ring-8 ring-brand-100'
                        : lv > 0
                          ? 'bg-brand-400 text-white shadow-[0_6px_0_#6d28d9]'
                          : 'bg-white text-brand-400 shadow-[0_6px_0_#e9e1fb] border-2 border-brand-100'
                  }`}
                >
                  {done ? '👑' : k + 1}
                  {!done && lv > 0 && (
                    <span className="absolute -bottom-2 rounded-full bg-white px-2 text-xs font-black text-brand-700 shadow">
                      {lv}/{LEVELS.length}
                    </span>
                  )}
                </button>
                <p className="mt-3 max-w-[14rem] truncate text-center text-sm font-semibold text-gray-600">{s.lines[0]?.text}</p>
              </li>
            )
          })}
          <li className="flex flex-col items-center">
            <button
              onClick={() => nav.go({ name: 'concert', songId })}
              className={`grid h-24 w-24 place-items-center rounded-3xl text-4xl transition active:translate-y-1 ${
                allDone ? 'bg-good-500 shadow-[0_6px_0_#15803d]' : 'border-2 border-brand-100 bg-white shadow-[0_6px_0_#e9e1fb]'
              }`}
            >
              🎤
            </button>
            <p className="mt-3 text-sm font-extrabold text-gray-700">Konsertläge</p>
            <p className="text-xs text-gray-500">Hela låten, bara komp, ingen text</p>
          </li>
        </ol>
      </main>

      <Sheet open={open !== null} onClose={() => setOpen(null)}>
        {openSec && open !== null && (
          <div className="space-y-4">
            <div>
              <p className="text-xs font-bold tracking-wide text-brand-600 uppercase">
                Steg {Math.min((levels[open] ?? 0) + 1, LEVELS.length)} av {LEVELS.length}
              </p>
              <p className="text-xl font-black">{LEVELS[openLevel].name}</p>
              <p className="text-sm text-gray-600">{LEVELS[openLevel].blurb}</p>
            </div>
            <div className="space-y-1 rounded-2xl bg-brand-50 p-3 text-sm">
              {openSec.lines.map((l, j) => (
                <p key={j}>
                  <LineText line={l} />
                </p>
              ))}
            </div>
            <button className="btn-primary w-full" onClick={() => start(open, openLevel)}>
              {(levels[open] ?? 0) >= LEVELS.length ? 'Öva igen' : 'Starta'}
            </button>
            <div className="flex flex-wrap gap-2">
              {LEVELS.map((L, li) => (
                <button key={L.name} disabled={li > (levels[open] ?? 0)} className="rounded-full bg-brand-100 px-3 py-1 text-xs font-bold text-brand-700 disabled:opacity-40" onClick={() => start(open, li)}>
                  {L.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </Sheet>
    </>
  )
}
