import { useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/db'
import { Mixer, unlockAudio } from '../lib/audio/engine'
import { useSettings } from '../settings'
import { LineText, TopBar, fmt } from '../components/ui'

/** Fine-tune where each line starts and ends, by ear. */
export default function Tune({ songId }: { songId: string }) {
  const { settings } = useSettings()
  const song = useLiveQuery(() => db.songs.get(songId), [songId])
  const [voice, setVoice] = useState(settings.voice!)
  const mixer = useRef(new Mixer()).current
  if (!song) return null
  const track = song.voices[voice] ?? Object.values(song.voices)[0]

  const play = async (from: number, to: number) => {
    unlockAudio()
    await mixer.setTracks([track.audioFileId])
    mixer.setLevel(track.audioFileId, 1)
    await mixer.play({ from: Math.max(0, from), to })
  }

  const nudge = async (s: number, l: number, field: 'start' | 'end', d: number) => {
    const sections = structuredClone(track.sections)
    const line = sections[s].lines[l]
    line[field] = Math.round(((line[field] ?? 0) + d) * 100) / 100
    if (field === 'start' && l === 0) sections[s].start = line.start
    if (field === 'end' && l === sections[s].lines.length - 1) sections[s].end = line.end
    await db.songs.update(songId, (s) => {
      s.voices[track.voice].sections = sections
    })
    if (field === 'start') void play(line.start!, line.start! + 2)
    else void play(line.end! - 2, line.end! + 0.3)
  }

  return (
    <>
      <TopBar title={`Justera tider · ${song.title}`} />
      <main className="space-y-3 px-4 pb-16">
        <div className="flex flex-wrap gap-2">
          {Object.keys(song.voices).map((v) => (
            <button key={v} className={`rounded-full px-3 py-1 text-sm font-extrabold ${v === track.voice ? 'bg-brand-600 text-white' : 'bg-brand-100 text-brand-700'}`} onClick={() => setVoice(v)}>
              {v}
            </button>
          ))}
        </div>
        <p className="text-sm text-gray-600">Spela en rad. Börjar eller slutar den fel? Flytta den en bit i taget. Ändringen sparas direkt.</p>
        {track.sections.map((s, si) =>
          s.lines.map((l, li) => (
            <div key={`${si}-${li}`} className="card space-y-2 py-3">
              <button className="w-full text-left font-semibold" onClick={() => void play((l.start ?? 0) - 0.2, (l.end ?? 0) + 0.3)}>
                ▶ <LineText line={l} />
              </button>
              <div className="flex items-center gap-1 text-sm">
                <span className="text-xs text-gray-500">Start</span>
                <button className="rounded-lg bg-brand-50 px-2 py-1 font-bold" onClick={() => nudge(si, li, 'start', -0.25)}>
                  −
                </button>
                <span className="w-14 text-center tabular-nums">{fmt(l.start)}</span>
                <button className="rounded-lg bg-brand-50 px-2 py-1 font-bold" onClick={() => nudge(si, li, 'start', 0.25)}>
                  +
                </button>
                <span className="ml-auto text-xs text-gray-500">Slut</span>
                <button className="rounded-lg bg-brand-50 px-2 py-1 font-bold" onClick={() => nudge(si, li, 'end', -0.25)}>
                  −
                </button>
                <span className="w-14 text-center tabular-nums">{fmt(l.end)}</span>
                <button className="rounded-lg bg-brand-50 px-2 py-1 font-bold" onClick={() => nudge(si, li, 'end', 0.25)}>
                  +
                </button>
              </div>
            </div>
          )),
        )}
      </main>
    </>
  )
}
