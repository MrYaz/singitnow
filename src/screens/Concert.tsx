import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/db'
import { Mixer, unlockAudio } from '../lib/audio/engine'
import { addXP, Rating, rateLine } from '../lib/learn'
import { learnable } from '../lib/exercises'
import { useNav } from '../nav'
import { useSettings } from '../settings'
import { Bar, TopBar } from '../components/ui'

/** Whole song with backing only and no lyrics. Afterwards, rate each part. */
export default function Concert({ songId }: { songId: string }) {
  const nav = useNav()
  const { settings } = useSettings()
  const voice = settings.voice!
  const song = useLiveQuery(() => db.songs.get(songId), [songId])
  const mixer = useRef(new Mixer()).current
  const [t, setT] = useState(0)
  const [phase, setPhase] = useState<'ready' | 'playing' | 'rate' | 'done'>('ready')
  const [ratings, setRatings] = useState<Record<number, number>>({})
  const [peek, setPeek] = useState(false)

  useEffect(() => {
    let raf = 0
    const tick = () => {
      setT(mixer.time)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    const off = mixer.onChange(() => {
      if (!mixer.playing) setPhase((p) => (p === 'playing' ? 'rate' : p))
    })
    return () => {
      cancelAnimationFrame(raf)
      off()
      mixer.stop()
    }
  }, [mixer])

  if (!song) return null
  const track = song.voices[voice]
  const secs = track ? learnable(track.sections) : []
  const first = secs[0]?.s.start ?? 0
  const cur = secs.find((x) => t >= (x.s.start ?? 0) - 1 && t < (x.s.end ?? 0) + 1)
  const curLine = cur?.s.lines.find((l) => t >= (l.start ?? 0) - 0.2 && t < (l.end ?? 0) + 0.3)

  const start = async () => {
    unlockAudio()
    const fid = song.musikFileId ?? track.audioFileId
    await mixer.setTracks([fid])
    mixer.setLevel(fid, 1)
    setPhase('playing')
    await mixer.play({ from: Math.max(0, first - 4) })
  }

  const save = async () => {
    for (const { s, i } of secs) {
      const g = ratings[i] ?? Rating.Good
      for (let l = 0; l < s.lines.length; l++) await rateLine(songId, voice, i, l, g as 1 | 2 | 3 | 4)
    }
    await addXP(30)
    setPhase('done')
  }

  return (
    <>
      <TopBar title={`Konsertläge · ${song.title}`} />
      <main className="flex flex-1 flex-col px-5 pb-8">
        {phase === 'ready' && (
          <div className="my-auto space-y-5 text-center">
            <div className="text-7xl">🎤</div>
            <h2 className="text-2xl font-black">Sjung hela låten utan text</h2>
            <p className="text-gray-600">Bara kompet spelas. Res dig upp, rör dig och lev dig in i låten. Det gör inget om något försvinner, det är så man lär sig.</p>
            <button className="btn-good w-full" onClick={start}>
              Starta
            </button>
          </div>
        )}
        {phase === 'playing' && (
          <div className="my-auto space-y-6 text-center">
            <p className="text-sm font-bold tracking-wide text-gray-400 uppercase">{cur ? `Del ${secs.indexOf(cur) + 1} av ${secs.length}` : 'Mellanspel'}</p>
            <p className="min-h-20 text-2xl font-black text-brand-700">{peek && curLine ? curLine.text : cur ? '🎶' : '…'}</p>
            <Bar value={t / song.duration} />
            <div className="flex gap-3">
              <button className="btn-ghost flex-1" onPointerDown={() => setPeek(true)} onPointerUp={() => setPeek(false)} onPointerLeave={() => setPeek(false)}>
                Håll för att kika
              </button>
              <button className="btn-primary flex-1" onClick={() => mixer.stop()}>
                Klar
              </button>
            </div>
          </div>
        )}
        {phase === 'rate' && (
          <div className="space-y-4 pt-4">
            <h2 className="text-2xl font-black">Hur gick varje del?</h2>
            {secs.map(({ s, i }, k) => (
              <div key={i} className="card space-y-2">
                <p className="text-sm font-bold">
                  Del {k + 1}: <span className="font-normal text-gray-600">{s.lines[0]?.text}</span>
                </p>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    [Rating.Again, 'Inte än'],
                    [Rating.Hard, 'Nästan'],
                    [Rating.Good, 'Satt!'],
                  ].map(([g, label]) => (
                    <button key={label} className={`rounded-xl py-2 text-sm font-extrabold ${(ratings[i] ?? Rating.Good) === g ? 'bg-brand-600 text-white' : 'bg-brand-50 text-brand-700'}`} onClick={() => setRatings((r) => ({ ...r, [i]: g as number }))}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <button className="btn-good w-full" onClick={save}>
              Spara
            </button>
          </div>
        )}
        {phase === 'done' && (
          <div className="my-auto space-y-5 text-center">
            <div className="pop text-7xl">🌟</div>
            <h2 className="text-2xl font-black">Vilken konsert!</h2>
            <p className="text-gray-600">Delarna som inte satt än kommer tillbaka i Dagens pass.</p>
            <button className="btn-primary w-full" onClick={nav.back}>
              Fortsätt
            </button>
          </div>
        )}
      </main>
    </>
  )
}
