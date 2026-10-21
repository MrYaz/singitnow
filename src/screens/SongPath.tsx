import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/db'
import { levelsFor } from '../lib/learn'
import { LEVELS, buildLesson, learnable } from '../lib/exercises'
import { useNav } from '../nav'
import { useSettings } from '../settings'
import { pickVoice } from '../lib/names'
import { LineText, Sheet, TopBar } from '../components/ui'

export default function SongPath({ songId }: { songId: string }) {
  const nav = useNav()
  const { settings } = useSettings()
  const song = useLiveQuery(() => db.songs.get(songId), [songId])
  const voice = pickVoice(song?.voices ?? {}, settings.voices) ?? ''
  const levels = useLiveQuery(() => levelsFor(songId, voice), [songId, voice])
  const [open, setOpen] = useState<number | null>(null)
  /** A step chosen to practise on every part, instead of each part's next step. */
  const [step, setStep] = useState<number | null>(null)
  if (!song || !levels) return null
  const track = song.voices[voice]
  if (!track) {
    return (
      <>
        <TopBar title={song.title} />
        <p className="p-4">Låten har ingen av dina stämmor ({settings.voices.join(', ')}). Välj fler stämmor i inställningarna.</p>
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
      title: `${song.title} · Steg ${level + 1} av ${LEVELS.length}: ${LEVELS[level].name}`,
      items: buildLesson(track.sections, section, level).map((ex) => ({ songId, voice, ex })),
      level: { songId, voice, section, level },
    })
  }

  const openSec = open !== null ? track.sections[open] : null
  const openLevel = open !== null ? (step ?? Math.min(levels[open] ?? 0, LEVELS.length - 1)) : 0

  return (
    <>
      <TopBar
        title={
          <span className="flex flex-col leading-tight">
            <span className="text-xs font-black tracking-wide text-brand-600 uppercase">Textträning</span>
            <span className="truncate">{song.title}</span>
          </span>
        }
        right={
          <button className="rounded-full bg-brand-100 px-3 py-1.5 text-sm font-extrabold text-brand-700" onClick={() => nav.go({ name: 'rehearsal', songId })}>
            Stämrep
          </button>
        }
      />
      <main className="px-4 pb-16">
        <section className="card mb-8">
          <p className="font-black">Varje del tränas i {LEVELS.length} steg</p>
          <p className="mb-3 text-sm text-gray-600">
            Appen tar dig till nästa steg av sig själv. Gillar du ett visst sätt att träna? Välj steget, så används det för alla delar.
          </p>
          <ol className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {LEVELS.map((L, li) => (
              <li key={L.name}>
                <button
                  aria-pressed={step === li}
                  onClick={() => setStep(step === li ? null : li)}
                  className={`flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left text-sm font-bold transition ${step === li ? 'bg-brand-600 text-white' : 'bg-brand-50 text-brand-700'}`}
                >
                  <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-black ${step === li ? 'bg-white text-brand-700' : 'bg-brand-200 text-brand-700'}`}>{li + 1}</span>
                  {L.name}
                </button>
              </li>
            ))}
          </ol>
          <p className="mt-3 text-xs text-gray-500">
            {step === null ? `Auto: nästa steg för varje del · ${voice}` : `Tränar steg ${step + 1}, ${LEVELS[step].name.toLowerCase()}, på alla delar. Tryck igen för auto.`}
          </p>
        </section>
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
                Steg {openLevel + 1} av {LEVELS.length}
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
              {openLevel < (levels[open] ?? 0) ? 'Öva igen' : 'Starta'}
            </button>
            <div>
              <p className="mb-2 text-xs font-bold text-gray-500">Eller hoppa till ett annat steg:</p>
              <div className="grid grid-cols-2 gap-2">
                {LEVELS.map((L, li) => (
                  <button
                    key={L.name}
                    className={`flex items-center gap-2 rounded-xl px-2 py-2 text-left text-sm font-bold ${li === openLevel ? 'bg-brand-600 text-white' : 'bg-brand-50 text-brand-700'}`}
                    onClick={() => start(open, li)}
                  >
                    <span className="w-5 text-center">{li < (levels[open] ?? 0) ? '✓' : li + 1}</span>
                    {L.name}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </Sheet>
    </>
  )
}
