import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/db'
import { doneFor, isDone } from '../lib/learn'
import { LEVELS, learnable, lessonFor } from '../lib/exercises'
import { useNav } from '../nav'
import { useSettings } from '../settings'
import { pickVoice } from '../lib/names'
import { TopBar } from '../components/ui'

/**
 * Text training for one song: pick a learning method first, then work through
 * the song part by part with it.
 */
export default function SongPath({ songId }: { songId: string }) {
  const nav = useNav()
  const { settings } = useSettings()
  const song = useLiveQuery(() => db.songs.get(songId), [songId])
  const voice = pickVoice(song?.voices ?? {}, settings.voices) ?? ''
  const done = useLiveQuery(() => doneFor(songId, voice), [songId, voice])
  const [picked, setPicked] = useState<number | null>(null)
  if (!song || !done) return null
  const track = song.voices[voice]
  if (!track) {
    return (
      <>
        <TopBar title={song.title} />
        <p className="p-4">Låten har ingen av dina stämmor ({settings.voices.join(', ')}). Välj fler stämmor i inställningarna.</p>
      </>
    )
  }
  const parts = learnable(track.sections)
  const countDone = (m: number) => parts.filter((x) => isDone(done[x.i], m)).length
  const firstOpen = LEVELS.findIndex((_, m) => countDone(m) < parts.length)
  const method = picked ?? (firstOpen < 0 ? 0 : firstOpen)
  const nextPart = parts.find((x) => !isDone(done[x.i], method)) ?? parts[0]
  const allMethods = firstOpen < 0

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
        <h2 className="mb-1 font-black">1. Välj inlärningssätt</h2>
        <p className="mb-3 text-sm text-gray-600">Gå igenom låten del för del med ett sätt i taget. Tips: börja uppifrån.</p>
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Inlärningssätt">
          {LEVELS.map((L, m) => {
            const n = countDone(m)
            const complete = parts.length > 0 && n === parts.length
            const on = m === method
            return (
              <button
                key={L.name}
                role="radio"
                aria-checked={on}
                onClick={() => setPicked(m)}
                className={`flex items-center gap-2 rounded-2xl border-2 px-3 py-2.5 text-left transition ${
                  on ? 'border-brand-600 bg-brand-600 text-white shadow-[0_4px_0_#4c1d95]' : complete ? 'border-good-500 bg-good-100 text-good-600' : 'border-brand-100 bg-white text-gray-800'
                }`}
              >
                <span
                  className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-sm font-black ${
                    complete ? 'bg-good-500 text-white' : on ? 'bg-white text-brand-700' : 'bg-brand-100 text-brand-700'
                  }`}
                >
                  {complete ? '✓' : m + 1}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm leading-tight font-extrabold">{L.name}</span>
                  <span className={`block text-xs ${on ? 'opacity-90' : 'text-gray-500'}`}>
                    {n}/{parts.length} delar
                  </span>
                </span>
              </button>
            )
          })}
        </div>

        <h2 className="mt-7 mb-1 font-black">2. {LEVELS[method].name}, del för del</h2>
        <p className="mb-3 text-sm text-gray-600">{LEVELS[method].blurb}</p>
        {nextPart && (
          <button className="btn-primary mb-4 w-full" onClick={() => nav.go(lessonFor(song, voice, nextPart.i, method))}>
            {countDone(method) === parts.length ? 'Öva igen från del 1' : `Starta del ${parts.indexOf(nextPart) + 1}`}
          </button>
        )}
        <ol className="space-y-2">
          {parts.map(({ s, i }, k) => {
            const ok = isDone(done[i], method)
            const isNext = nextPart?.i === i && !ok
            return (
              <li key={i}>
                <button
                  aria-label={`Del ${k + 1}`}
                  onClick={() => nav.go(lessonFor(song, voice, i, method))}
                  className={`flex w-full items-center gap-3 rounded-2xl border-2 bg-white px-3 py-2.5 text-left transition active:translate-y-0.5 ${
                    isNext ? 'border-brand-400' : ok ? 'border-good-500/40' : 'border-brand-100'
                  }`}
                >
                  <span
                    className={`grid h-9 w-9 shrink-0 place-items-center rounded-full font-black ${ok ? 'bg-good-500 text-white' : isNext ? 'bg-brand-600 text-white' : 'bg-brand-50 text-brand-700'}`}
                  >
                    {ok ? '✓' : k + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-bold text-gray-500">Del {k + 1}</span>
                    <span className="block truncate font-semibold">{s.lines[0]?.text}</span>
                  </span>
                  <span className="text-brand-400">›</span>
                </button>
              </li>
            )
          })}
        </ol>

        <button
          onClick={() => nav.go({ name: 'concert', songId })}
          className={`mt-8 flex w-full items-center gap-4 rounded-3xl border-2 p-4 text-left ${allMethods ? 'border-good-500 bg-good-100' : 'border-brand-100 bg-white'}`}
        >
          <span className="text-4xl">🎤</span>
          <span>
            <span className="block font-extrabold">Konsertläge</span>
            <span className="block text-xs text-gray-500">Hela låten, bara komp, ingen text</span>
          </span>
        </button>
        <p className="mt-3 text-center text-xs text-gray-400">Du övar {voice}.</p>
      </main>
    </>
  )
}
