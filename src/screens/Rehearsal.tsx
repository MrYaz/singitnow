import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/db'
import { Mixer, unlockAudio } from '../lib/audio/engine'
import { shortVoice, sortVoices, pickVoice } from '../lib/names'
import { useSettings } from '../settings'
import { refineVoice } from '../lib/refine'
import { LineText, OthersText, TopBar, fmt, othersVoices } from '../components/ui'

interface Track {
  id: string
  label: string
  short: string
  voice?: string
}

type Loop = { from: number; to: number; label: string } | null

export default function Rehearsal({ songId }: { songId: string }) {
  const { settings } = useSettings()
  const song = useLiveQuery(() => db.songs.get(songId), [songId])
  const mixer = useRef(new Mixer()).current
  const [ready, setReady] = useState(false)
  const [err, setErr] = useState('')
  const [playing, setPlaying] = useState(false)
  const [t, setT] = useState(0)
  const [levels, setLevels] = useState<Record<string, number>>({})
  const [loop, setLoop] = useState<Loop>(null)
  const [showMixer, setShowMixer] = useState(false)
  const [hideText, setHideText] = useState(false)
  const [refining, setRefining] = useState<number | null>(null)

  const tracks: Track[] = useMemo(() => {
    if (!song) return []
    const vs = sortVoices(Object.keys(song.voices))
    const out: Track[] = vs.map((v) => ({ id: song.voices[v].audioFileId, label: v, short: shortVoice(v), voice: v }))
    if (song.allaFileId) out.push({ id: song.allaFileId, label: 'ALLA', short: 'ALLA' })
    if (song.musikFileId) out.push({ id: song.musikFileId, label: 'Musik', short: 'Musik' })
    return out
  }, [song])

  const own = tracks.find((x) => x.voice === pickVoice(song?.voices ?? {}, settings.voices)) ?? tracks[0]

  useEffect(() => {
    if (!tracks.length) return
    const init: Record<string, number> = {}
    for (const tr of tracks) init[tr.id] = tr.id === own?.id ? 1 : 0
    setLevels(init)
    for (const [id, v] of Object.entries(init)) mixer.setLevel(id, v)
    mixer
      .setTracks(tracks.map((x) => x.id))
      .then(() => setReady(true))
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
    const off = mixer.onChange(() => setPlaying(mixer.playing))
    return () => {
      off()
      mixer.stop()
    }
  }, [tracks, own?.id, mixer])

  useEffect(() => {
    let raf = 0
    const tick = () => {
      setT(mixer.time)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [mixer])

  if (!song) return null

  const setLevel = (id: string, v: number) => {
    setLevels((l) => ({ ...l, [id]: v }))
    mixer.setLevel(id, v)
  }
  const solo = (id: string) => {
    for (const tr of tracks) setLevel(tr.id, tr.id === id ? 1 : 0)
  }
  const soloed = tracks.filter((x) => (levels[x.id] ?? 0) > 0)
  const soloId = soloed.length === 1 ? soloed[0].id : null

  // Show the lyrics of the loudest voice that has lyrics.
  const textVoice = [...tracks].filter((x) => x.voice).sort((a, b) => (levels[b.id] ?? 0) - (levels[a.id] ?? 0))[0]
  const lyricVoice = (textVoice && (levels[textVoice.id] ?? 0) > 0 ? textVoice.voice : own?.voice) ?? Object.keys(song.voices)[0]
  const sections = song.voices[lyricVoice]?.sections ?? []

  const play = async (from: number, l: Loop = loop) => {
    unlockAudio()
    if (l) await mixer.play({ from: Math.max(l.from, Math.min(from, l.to - 0.1)), to: l.to, loop: true })
    else await mixer.play({ from })
  }
  const toggle = () => (playing ? mixer.stop() : void play(loop ? loop.from : t))
  const loopIt = (from: number, to: number, label: string) => {
    // A second tap on what is already looping turns the loop off and lets the song play on.
    if (loop?.label === label) return clearLoop()
    const l = { from: Math.max(0, from), to, label }
    setLoop(l)
    void play(l.from, l)
  }
  const clearLoop = () => {
    setLoop(null)
    if (playing) void mixer.play({ from: mixer.time })
  }

  return (
    <>
      <TopBar
        title={`Stämrep · ${song.title}`}
        right={
          <button className="rounded-full bg-brand-100 px-3 py-1.5 text-sm font-extrabold text-brand-700" onClick={() => setHideText((h) => !h)}>
            {hideText ? 'Visa text' : 'Dölj text'}
          </button>
        }
      />
      <main className="flex-1 px-4 pb-64">
        {err && <p className="rounded-2xl bg-warm-100 p-3 text-sm font-semibold">{err}</p>}
        {song.voices[lyricVoice] && song.voices[lyricVoice].timing !== 'speech' && (
          <button
            className="mb-3 w-full rounded-2xl bg-brand-50 p-3 text-left text-sm"
            disabled={refining !== null}
            onClick={async () => {
              setRefining(0)
              try {
                await refineVoice(song, lyricVoice, setRefining)
              } catch (e) {
                setErr(e instanceof Error ? e.message : String(e))
              } finally {
                setRefining(null)
              }
            }}
          >
            <span className="font-bold text-brand-700">
              {refining === null ? `Texten för ${lyricVoice} är ungefärligt synkad. Tryck här för att finjustera.` : `Finjusterar synken för ${lyricVoice}… ${Math.round(refining * 100)} %`}
            </span>
          </button>
        )}
        <div className="space-y-4">
          {sections.map((s, si) => {
            if (!s.lines.length && !s.rest && !s.note) return null
            const st = s.start ?? s.pdfStart ?? 0
            const en = s.end ?? st + 10
            const inSec = t >= st - 0.3 && t < en + 0.5
            return (
              <section key={si} className={`card transition ${inSec && playing ? 'border-brand-400' : ''}`}>
                <div className="mb-2 flex items-center gap-2">
                  <button className="text-xs font-black tracking-wide text-brand-600 uppercase" onClick={() => loopIt(st - 0.8, en + 0.6, `Del ${si + 1}`)}>
                    🔁 Del {si + 1} · {fmt(st).replace(/\.\d$/, '')}
                  </button>
                  {s.rest && (
                    <span className="text-xs text-gray-400">
                      tyst{othersVoices(s.others).length > 0 && ` (${othersVoices(s.others).join(', ')})`}
                    </span>
                  )}
                  {s.note && <span className="text-xs text-gray-400 italic">{s.note}</span>}
                </div>
                {!hideText &&
                  s.lines.map((l, li) => {
                    const on = playing && t >= (l.start ?? 0) - 0.1 && t < (l.end ?? 0) + 0.2
                    const looped = loop && loop.label === `${si}:${li}`
                    return (
                      <button
                        key={li}
                        className={`block w-full rounded-lg px-1 py-1 text-left text-lg transition ${on ? 'bg-brand-100 font-extrabold text-brand-700' : ''} ${looped ? 'ring-2 ring-brand-400' : ''}`}
                        onClick={() => loopIt((l.start ?? st) - 0.3, (l.end ?? en) + 0.4, `${si}:${li}`)}
                      >
                        <LineText line={l} />
                      </button>
                    )
                  })}
                {!hideText && !s.lines.length && s.others.length > 0 && <OthersText others={s.others} />}
                {hideText && <p className="text-gray-400">{s.lines.length} rader</p>}
              </section>
            )
          })}
        </div>
        <p className="mt-4 text-center text-xs text-gray-500">Tryck på en rad för att loopa den, eller på "Del" för hela formdelen.</p>
      </main>

      <div className="fixed inset-x-0 bottom-0 z-20 mx-auto max-w-xl rounded-t-3xl border-t-2 border-brand-100 bg-white px-4 pt-3 pb-[max(env(safe-area-inset-bottom),14px)] shadow-[0_-8px_24px_rgba(76,29,149,0.08)]">
        <div className="mb-3 flex flex-wrap justify-center gap-1.5" role="group" aria-label="Solo">
          {tracks.map((tr) => (
            <button
              key={tr.id}
              aria-pressed={soloId === tr.id}
              className={`min-w-12 rounded-xl px-2.5 py-2 text-sm font-black transition ${soloId === tr.id ? 'bg-brand-600 text-white shadow-[0_3px_0_#4c1d95]' : (levels[tr.id] ?? 0) > 0 ? 'bg-brand-100 text-brand-700' : 'bg-gray-100 text-gray-500'}`}
              onClick={() => solo(tr.id)}
            >
              {tr.short}
            </button>
          ))}
          <button className={`rounded-xl px-2.5 py-2 text-sm font-black ${showMixer ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-500'}`} onClick={() => setShowMixer((m) => !m)} aria-label="Mixer">
            🎚️
          </button>
        </div>
        {showMixer && (
          <div className="mb-3 space-y-1.5">
            {tracks.map((tr) => (
              <label key={tr.id} className="flex items-center gap-3 text-sm font-bold">
                <span className="w-14">{tr.short}</span>
                <input type="range" min={0} max={1} step={0.05} value={levels[tr.id] ?? 0} onChange={(e) => setLevel(tr.id, Number(e.target.value))} className="flex-1 accent-brand-600" />
              </label>
            ))}
            <p className="text-xs text-gray-400">Varje stämfil har kompet inbakat, så kompet blir starkare när du mixar flera.</p>
          </div>
        )}
        <input
          type="range"
          min={0}
          max={song.duration}
          step={0.1}
          value={Math.min(t, song.duration)}
          onChange={(e) => {
            const v = Number(e.target.value)
            if (loop) setLoop(null)
            if (playing) void mixer.play({ from: v })
            else mixer.seek(v)
          }}
          className="w-full accent-brand-600"
          aria-label="Position"
        />
        <div className="flex items-center gap-2">
          <span className="w-12 text-xs font-bold text-gray-500 tabular-nums">{fmt(t).replace(/\.\d$/, '')}</span>
          <button className="grid h-11 w-11 place-items-center rounded-full bg-brand-50 text-lg" aria-label="5 sekunder bakåt" onClick={() => void play(Math.max(0, t - 5), null)}>
            ↺
          </button>
          <button className="grid h-14 w-14 place-items-center rounded-full bg-brand-600 text-2xl text-white shadow-[0_4px_0_#4c1d95] disabled:opacity-40" disabled={!ready} onClick={toggle} aria-label={playing ? 'Pausa' : 'Spela'}>
            {playing ? '❚❚' : '▶'}
          </button>
          {loop ? (
            <button className="flex-1 truncate rounded-full bg-brand-100 px-3 py-2 text-sm font-extrabold text-brand-700" onClick={clearLoop}>
              🔁 Loopar {loop.label.includes(':') ? 'raden' : loop.label.toLowerCase()} ✕
            </button>
          ) : (
            <span className="flex-1 text-center text-xs text-gray-400">{ready ? 'Ingen loop' : 'Laddar ljudet…'}</span>
          )}
        </div>
      </div>
    </>
  )
}
