import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { Grade } from 'ts-fsrs'
import { db } from '../lib/db'
import { addXP, completeMethod, Rating, rateLine } from '../lib/learn'
import { LEVELS, bare, initials, learnable, lessonFor, tokens, type Exercise } from '../lib/exercises'
import { Mixer, unlockAudio } from '../lib/audio/engine'
import type { Line, Song } from '../lib/types'
import { useNav, type LessonItem, type LessonTarget } from '../nav'
import { useSettings } from '../settings'
import { Bar, LineText } from '../components/ui'
import { withName } from '../lib/cheer'
import { shortVoice, sortVoices } from '../lib/names'

const PRAISE = ['Snyggt!', 'Bra jobbat!', 'Toppen!', 'Så ska det låta!', 'Wow!', 'Helt rätt!']
const KIND = ['Den tar vi igen snart 💜', 'Nästa gång sitter den!', 'Bra försök, vi övar mer på den.']
const XP_PER = 10

type Outcome = { grade: Grade } | { grade: null }

export default function Lesson({ title, items, level }: { title: string; items: LessonItem[]; level?: LessonTarget }) {
  const nav = useNav()
  const { settings } = useSettings()
  const songIds = useMemo(() => [...new Set(items.map((i) => i.songId))], [items])
  const songs = useLiveQuery(() => db.songs.bulkGet(songIds), [songIds])
  const [idx, setIdx] = useState(0)
  const [result, setResult] = useState<Outcome | null>(null)
  const [stats, setStats] = useState({ good: 0, total: 0 })
  const [silent, setSilent] = useState(settings.silent)
  const mixer = useRef(new Mixer()).current
  /** What to listen to: 'alla', 'musik' or a voice name. Resolved per song, since a lesson can span songs. */
  const [hear, setHear] = useState<string>('alla')

  useEffect(() => () => mixer.stop(), [mixer])

  if (!songs) return null
  const songMap = new Map(songs.filter(Boolean).map((s) => [s!.id, s!]))
  const done = idx >= items.length

  const finish = async (o: Outcome) => {
    const it = items[idx]
    const ex = it.ex
    setResult(o)
    if (o.grade !== null && 'line' in ex) await rateLine(it.songId, it.voice, ex.section, ex.line, o.grade)
    if (o.grade !== null && ex.type === 'order') for (const l of ex.lines) await rateLine(it.songId, it.voice, ex.section, l, o.grade)
    await addXP(XP_PER)
    setStats((s) => ({ good: s.good + (o.grade === null || o.grade >= Rating.Good ? 1 : 0), total: s.total + 1 }))
  }

  const next = async () => {
    mixer.stop()
    setResult(null)
    if (idx + 1 >= items.length && level) await completeMethod(level.songId, level.voice, level.section, level.level)
    setIdx((i) => i + 1)
  }

  if (done) {
    const share = stats.total ? stats.good / stats.total : 1
    // The next part of the song, practised the same way.
    const lvSong = level ? songMap.get(level.songId) : undefined
    const parts = lvSong ? learnable(lvSong.voices[level!.voice]?.sections ?? []) : []
    const at = level ? parts.findIndex((x) => x.i === level.section) : -1
    const nextPart = at >= 0 ? parts[at + 1] : undefined
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-5 px-6 text-center">
        <div className="pop text-7xl">{share > 0.8 ? '🏆' : share > 0.5 ? '🌟' : '💜'}</div>
        <h1 className="text-3xl font-black text-brand-700">{withName(share > 0.8 ? 'Strålande!' : share > 0.5 ? 'Bra jobbat!' : 'Bra kämpat!', settings.name, 0)}</h1>
        <p className="text-gray-600">
          {!level
            ? 'Dagens repetition är klar.'
            : nextPart
              ? `Del ${at + 1} av ${parts.length} är klar med ${LEVELS[level.level].name.toLowerCase()}.`
              : `Sista delen är klar med ${LEVELS[level.level].name.toLowerCase()}!`}
        </p>
        <div className="flex gap-3">
          <div className="card min-w-28">
            <p className="text-xs font-bold text-warm-500 uppercase">XP</p>
            <p className="text-2xl font-black">+{stats.total * XP_PER}</p>
          </div>
          <div className="card min-w-28">
            <p className="text-xs font-bold text-good-600 uppercase">Satt</p>
            <p className="text-2xl font-black">{Math.round(share * 100)}%</p>
          </div>
        </div>
        {level && lvSong && nextPart ? (
          <div className="mt-4 flex w-full max-w-xs flex-col gap-3">
            <button className="btn-primary" onClick={() => nav.replace(lessonFor(lvSong, level.voice, nextPart.i, level.level))}>
              Nästa del →
            </button>
            <button className="btn-ghost" onClick={nav.back}>
              Tillbaka till låten
            </button>
          </div>
        ) : (
          <button className="btn-primary mt-4 w-full max-w-xs" onClick={nav.back}>
            {level ? 'Tillbaka till låten' : 'Fortsätt'}
          </button>
        )}
      </main>
    )
  }

  const it = items[idx]
  const song = songMap.get(it.songId)
  const track = song?.voices[it.voice]
  if (!song || !track) return null

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="flex items-center gap-3 px-4 pt-[max(env(safe-area-inset-top),14px)] pb-3">
        <button aria-label="Avsluta" className="text-2xl text-gray-400" onClick={nav.back}>
          ✕
        </button>
        <div className="flex-1">
          <p className="mb-1 text-sm font-black text-brand-700">Textträning</p>
          <Bar value={idx / items.length} />
        </div>
        <button
          aria-label={silent ? 'Slå på ljud' : 'Tyst läge'}
          className={`rounded-full px-2 py-1 text-lg ${silent ? 'bg-gray-200' : 'bg-brand-100'}`}
          onClick={() => {
            mixer.stop()
            setSilent((s) => !s)
          }}
        >
          {silent ? '🔇' : '🔊'}
        </button>
      </header>
      <p className="px-5 text-xs font-bold tracking-wide text-gray-400 uppercase">{title}</p>
      {!silent && (
        <HearPicker
          song={song}
          voice={it.voice}
          value={hear}
          onChange={async (v) => {
            setHear(v)
            // Switch voice without stopping: carry on from the same spot to the same end.
            const file = hearFile(song, it.voice, v)
            if (!mixer.playing || !file) return
            const from = mixer.time
            const to = mixer.until
            await mixer.setTracks([file])
            mixer.setLevel(file, 1)
            if (to === undefined || to > from + 0.1) await mixer.play({ from, to })
          }}
        />
      )}
      <main className="flex flex-1 flex-col px-5 pt-3">
        <ExerciseView key={idx} ex={it.ex} song={song} voice={it.voice} silent={silent} hear={hearFile(song, it.voice, hear)} hearLabel={hearLabel(song, it.voice, hear)} mixer={mixer} answered={result !== null} onResult={finish} />
      </main>
      <Footer result={result} onNext={next} seed={idx} name={settings.name} />
    </div>
  )
}

function Footer({ result, onNext, seed, name }: { result: Outcome | null; onNext: () => void; seed: number; name: string }) {
  if (!result) return null
  const good = result.grade === null || result.grade >= Rating.Good
  const base = result.grade === null ? 'Fint!' : good ? PRAISE[seed % PRAISE.length] : KIND[seed % KIND.length]
  const text = good ? withName(base, name, seed) : base
  return (
    <div className={`pop sticky bottom-0 space-y-3 px-5 pt-4 pb-[max(env(safe-area-inset-bottom),20px)] ${good ? 'bg-good-100' : 'bg-warm-100'}`}>
      <p className={`text-xl font-black ${good ? 'text-good-600' : 'text-amber-700'}`}>{text}</p>
      <button className={`${good ? 'btn-good' : 'btn-primary'} w-full`} onClick={onNext} autoFocus>
        Fortsätt
      </button>
    </div>
  )
}

interface ExProps {
  ex: Exercise
  song: Song
  voice: string
  silent: boolean
  /** The file chosen in "Lyssna på", and its name. */
  hear: string | undefined
  hearLabel: string
  mixer: Mixer
  answered: boolean
  onResult: (o: Outcome) => void
}

/** The file to play for a listening choice. ALLA falls back to your own voice when a song has no ALLA file. */
function hearFile(song: Song, voice: string, hear: string): string | undefined {
  if (hear === 'alla') return song.allaFileId ?? song.voices[voice]?.audioFileId
  if (hear === 'musik') return song.musikFileId ?? song.voices[voice]?.audioFileId
  return (song.voices[hear] ?? song.voices[voice])?.audioFileId
}

function hearLabel(song: Song, voice: string, hear: string): string {
  if (hear === 'alla' && song.allaFileId) return 'ALLA'
  if (hear === 'musik' && song.musikFileId) return 'Musik'
  return song.voices[hear] ? hear : voice
}

/** Lets you listen to any voice (or ALLA) while you practise. */
function HearPicker({ song, voice, value, onChange }: { song: Song; voice: string; value: string; onChange: (v: string) => void }) {
  const opts: { id: string; label: string }[] = []
  if (song.allaFileId) opts.push({ id: 'alla', label: 'ALLA' })
  for (const v of sortVoices(Object.keys(song.voices))) opts.push({ id: v, label: shortVoice(v) + (v === voice ? ' ★' : '') })
  if (song.musikFileId) opts.push({ id: 'musik', label: 'Musik' })
  // What is actually playing, after falling back for songs without ALLA or Musik.
  const sel = (value === 'alla' && song.allaFileId) || (value === 'musik' && song.musikFileId) ? value : song.voices[value] ? value : voice
  const isOn = (o: { id: string }) => o.id === sel
  return (
    <div className="flex flex-wrap items-center gap-1.5 px-5 pt-2" role="group" aria-label="Lyssna på">
      <span className="text-xs font-bold text-gray-500">Lyssna på</span>
      {opts.map((o) => (
        <button
          key={o.id}
          aria-pressed={isOn(o)}
          className={`rounded-lg px-2 py-1 text-xs font-black ${isOn(o) ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-600'}`}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function useClips(song: Song, voice: string, mixer: Mixer, silent: boolean, hear: string | undefined) {
  const track = song.voices[voice]
  const [playing, setPlaying] = useState(false)
  useEffect(() => {
    const off = mixer.onChange(() => setPlaying(mixer.playing))
    return () => {
      off()
    }
  }, [mixer])
  const play = async (fileId: string | undefined, from?: number, to?: number) => {
    fileId = hear ?? fileId
    if (silent || !fileId || from === undefined || to === undefined) return
    unlockAudio()
    await mixer.setTracks([fileId])
    mixer.setLevel(fileId, 1)
    await mixer.play({ from: Math.max(0, from), to })
  }
  const line = (s: number, l: number) => track.sections[s].lines[l]
  return {
    playing,
    stop: () => mixer.stop(),
    playLine: (s: number, l: number) => {
      const ln = line(s, l)
      return play(track.audioFileId, (ln.start ?? 0) - 0.15, (ln.end ?? 0) + 0.3)
    },
    /** Plays what comes right before a line, ending where you should start singing. */
    playLead: (s: number, l: number) => {
      const ln = line(s, l)
      const prev = l > 0 ? line(s, l - 1) : null
      const from = prev?.start ?? (ln.start ?? 0) - 4
      return play(track.audioFileId, from - 0.2, (ln.start ?? 0) - 0.05)
    },
    playSection: (s: number, which: 'alla' | 'voice') => {
      const sec = track.sections[s]
      return play(which === 'alla' ? song.allaFileId : track.audioFileId, (sec.start ?? sec.pdfStart ?? 0) - 1, (sec.end ?? (sec.start ?? 0) + 20) + 0.8)
    },
  }
}

function ExerciseView(p: ExProps) {
  switch (p.ex.type) {
    case 'listen':
      return <Listen {...p} ex={p.ex} />
    case 'choose':
      return <Choose {...p} ex={p.ex} />
    case 'tiles':
      return <Tiles {...p} ex={p.ex} />
    case 'order':
      return <Order {...p} ex={p.ex} />
    case 'initials':
    case 'fade':
    case 'sing':
      return <Recall {...p} ex={p.ex} />
  }
}

const Prompt = ({ children }: { children: React.ReactNode }) => <h2 className="mb-5 text-2xl font-black">{children}</h2>

function ContextLine({ line }: { line?: Line }) {
  if (!line) return null
  return <p className="mb-2 text-gray-400">{line.text}</p>
}

function PlayButton({ onClick, playing, label = 'Lyssna' }: { onClick: () => void; playing: boolean; label?: string }) {
  return (
    <button className="btn-ghost" onClick={onClick}>
      {playing ? '⏸' : '▶'} {label}
    </button>
  )
}

function Listen({ ex, song, voice, silent, hear, hearLabel, mixer, answered, onResult }: ExProps & { ex: Extract<Exercise, { type: 'listen' }> }) {
  const clips = useClips(song, voice, mixer, silent, hear)
  const sec = song.voices[voice].sections[ex.section]
  const [t, setT] = useState(0)
  useEffect(() => {
    let raf = 0
    const tick = () => {
      setT(mixer.time)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [mixer])
  useEffect(() => {
    if (!silent) void clips.playSection(ex.section, ex.track)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const isAlla = hearLabel === 'ALLA'
  return (
    <>
      <Prompt>{silent ? 'Läs igenom delen. Vad handlar den om?' : `Lyssna på ${hearLabel} och följ med i texten`}</Prompt>
      <div className="card space-y-2 text-lg leading-relaxed">
        {sec.lines.map((l, i) => {
          const on = clips.playing && t >= (l.start ?? 0) - 0.1 && t < (l.end ?? 0) + 0.2
          return (
            <p key={i} className={`rounded-lg px-1 transition ${on ? 'bg-brand-100 font-extrabold text-brand-700' : ''}`}>
              <LineText line={l} />
            </p>
          )
        })}
      </div>
      {isAlla && sec.others.length > 0 && (
        <div className="mt-3 rounded-2xl bg-brand-50 p-3 text-sm text-gray-600">
          <p className="font-bold text-brand-700">Samtidigt sjunger de andra:</p>
          {sec.others.map((o, i) => (
            <p key={i} className="italic">
              {o}
            </p>
          ))}
        </div>
      )}
      <p className="mt-3 text-xs text-gray-500">
        <span className="harmony">Markerat</span> = stämsång, din stämma sjunger något eget.
      </p>
      <div className="mt-auto flex gap-3 pt-6 pb-4">
        {!silent && <PlayButton playing={clips.playing} onClick={() => (clips.playing ? clips.stop() : void clips.playSection(ex.section, ex.track))} label="Igen" />}
        {!answered && (
          <button className="btn-primary flex-1" onClick={() => onResult({ grade: null })}>
            Klar
          </button>
        )}
      </div>
    </>
  )
}

function Choose({ ex, song, voice, silent, hear, mixer, answered, onResult }: ExProps & { ex: Extract<Exercise, { type: 'choose' }> }) {
  const clips = useClips(song, voice, mixer, silent, hear)
  const sec = song.voices[voice].sections[ex.section]
  const line = sec.lines[ex.line]
  const words = tokens(line.text)
  const answer = bare(words[ex.blank])
  const [wrong, setWrong] = useState<string[]>([])
  const [picked, setPicked] = useState<string | null>(null)
  const pick = (o: string) => {
    if (answered) return
    if (bare(o) === answer) {
      setPicked(o)
      void clips.playLine(ex.section, ex.line)
      onResult({ grade: wrong.length === 0 ? Rating.Good : wrong.length === 1 ? Rating.Hard : Rating.Again })
    } else setWrong((w) => [...w, o])
  }
  return (
    <>
      <Prompt>Vilket ord saknas?</Prompt>
      <ContextLine line={sec.lines[ex.line - 1]} />
      <p className="text-2xl leading-relaxed font-bold">
        {words.map((w, i) =>
          i === ex.blank ? (
            <span key={i} className={`mx-1 inline-block min-w-16 border-b-4 text-center ${picked ? 'border-good-500 text-good-600' : 'border-brand-400 text-transparent'}`}>
              {picked ? w : '___'}
            </span>
          ) : (
            <span key={i}> {w} </span>
          ),
        )}
      </p>
      <div className="mt-auto grid grid-cols-2 gap-3 pt-8 pb-4">
        {ex.options.map((o) => {
          const isWrong = wrong.includes(o)
          const isRight = picked === o
          return (
            <button
              key={o}
              disabled={isWrong || answered}
              className={`btn border-2 py-4 text-lg ${isRight ? 'border-good-500 bg-good-100 text-good-600' : isWrong ? 'shake border-gray-200 bg-gray-100 text-gray-400' : 'border-brand-100 bg-white shadow-[0_3px_0_#e9e1fb]'}`}
              onClick={() => pick(o)}
            >
              {o}
            </button>
          )
        })}
      </div>
    </>
  )
}

function Tiles({ ex, song, voice, silent, hear, mixer, answered, onResult }: ExProps & { ex: Extract<Exercise, { type: 'tiles' }> }) {
  const clips = useClips(song, voice, mixer, silent, hear)
  const sec = song.voices[voice].sections[ex.section]
  const line = sec.lines[ex.line]
  const target = tokens(line.text).map(bare)
  const [chosen, setChosen] = useState<number[]>([])
  const [mistakes, setMistakes] = useState(0)
  const [shake, setShake] = useState(false)
  const full = chosen.length === ex.tiles.length
  const check = () => {
    const got = chosen.map((i) => bare(ex.tiles[i]))
    if (got.join(' ') === target.join(' ')) {
      void clips.playLine(ex.section, ex.line)
      onResult({ grade: mistakes === 0 ? Rating.Good : mistakes === 1 ? Rating.Hard : Rating.Again })
    } else {
      // Keep the correct beginning, give the rest back.
      let k = 0
      while (k < got.length && got[k] === target[k]) k++
      setMistakes((m) => m + 1)
      setShake(true)
      setTimeout(() => {
        setShake(false)
        setChosen((c) => c.slice(0, k))
      }, 500)
    }
  }
  return (
    <>
      <Prompt>Bygg raden</Prompt>
      <ContextLine line={sec.lines[ex.line - 1]} />
      <div className={`flex min-h-24 flex-wrap content-start gap-2 border-y-2 border-brand-100 py-3 ${shake ? 'shake' : ''}`}>
        {chosen.map((ti, k) => (
          <button key={k} disabled={answered} className="rounded-xl border-2 border-brand-200 bg-white px-3 py-2 text-lg font-bold shadow-[0_3px_0_#e9e1fb]" onClick={() => setChosen((c) => c.filter((x) => x !== ti))}>
            {ex.tiles[ti]}
          </button>
        ))}
      </div>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        {ex.tiles.map((w, i) => {
          const used = chosen.includes(i)
          return (
            <button key={i} disabled={used || answered} className={`rounded-xl border-2 px-3 py-2 text-lg font-bold ${used ? 'border-gray-100 bg-gray-100 text-transparent' : 'border-brand-200 bg-white shadow-[0_3px_0_#e9e1fb]'}`} onClick={() => setChosen((c) => [...c, i])}>
              {w}
            </button>
          )
        })}
      </div>
      {mistakes > 1 && !answered && <p className="mt-4 text-center text-sm text-gray-500">Ledtråd: {initials(line.text)}</p>}
      <div className="mt-auto pt-8 pb-4">
        {!answered && (
          <button className="btn-primary w-full" disabled={!full} onClick={check}>
            Kolla
          </button>
        )}
      </div>
    </>
  )
}

function Order({ ex, song, voice, answered, onResult }: ExProps & { ex: Extract<Exercise, { type: 'order' }> }) {
  const sec = song.voices[voice].sections[ex.section]
  const [chosen, setChosen] = useState<number[]>([])
  const [mistakes, setMistakes] = useState(0)
  const [shake, setShake] = useState(false)
  const pick = (l: number) => {
    const expected = [...ex.lines].sort((a, b) => a - b)[chosen.length]
    if (sec.lines[l].text === sec.lines[expected].text) {
      const c = [...chosen, l]
      setChosen(c)
      if (c.length === ex.lines.length) onResult({ grade: mistakes === 0 ? Rating.Good : mistakes < 3 ? Rating.Hard : Rating.Again })
    } else {
      setMistakes((m) => m + 1)
      setShake(true)
      setTimeout(() => setShake(false), 500)
    }
  }
  return (
    <>
      <Prompt>Tryck på raderna i rätt ordning</Prompt>
      <ol className="mb-4 space-y-2">
        {chosen.map((l, k) => (
          <li key={k} className="rounded-xl bg-good-100 px-3 py-2 font-bold text-good-600">
            {sec.lines[l].text}
          </li>
        ))}
      </ol>
      <div className={`space-y-2 ${shake ? 'shake' : ''}`}>
        {ex.lines
          .filter((l) => !chosen.includes(l))
          .map((l) => (
            <button key={l} disabled={answered} className="w-full rounded-xl border-2 border-brand-100 bg-white px-3 py-3 text-left font-semibold shadow-[0_3px_0_#e9e1fb]" onClick={() => pick(l)}>
              {sec.lines[l].text}
            </button>
          ))}
      </div>
    </>
  )
}

/** Initials, fading words and "sing it yourself": recall, then rate yourself. */
function Recall({ ex, song, voice, silent, hear, mixer, answered, onResult }: ExProps & { ex: Extract<Exercise, { type: 'initials' | 'fade' | 'sing' }> }) {
  const clips = useClips(song, voice, mixer, silent, hear)
  const sec = song.voices[voice].sections[ex.section]
  const line = sec.lines[ex.line]
  const prev = sec.lines[ex.line - 1]
  const [shown, setShown] = useState(false)
  useEffect(() => {
    if (ex.type === 'sing' && !silent) void clips.playLead(ex.section, ex.line)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const words = tokens(line.text)
  const hint =
    ex.type === 'initials' ? (
      <p className="text-3xl font-black tracking-wider text-brand-700">{initials(line.text)}</p>
    ) : ex.type === 'fade' ? (
      <p className="text-2xl leading-relaxed font-bold">
        {words.map((w, i) =>
          ex.hidden.includes(i) ? (
            <span key={i} className="mx-1 inline-block rounded bg-brand-100 text-transparent select-none">
              {w}
            </span>
          ) : (
            <span key={i}> {w} </span>
          ),
        )}
      </p>
    ) : (
      <p className="text-5xl">🎤</p>
    )

  const prompt = ex.type === 'sing' ? (silent ? 'Sjung raden som kommer efter' : 'Din tur! Sjung nästa rad') : ex.type === 'initials' ? 'Sjung raden från första bokstäverna' : 'Sjung raden, fyll i det som saknas'

  return (
    <>
      <Prompt>{prompt}</Prompt>
      {(ex.type !== 'sing' || silent || !clips.playing) && <ContextLine line={prev} />}
      {!prev && ex.type === 'sing' && <p className="mb-2 text-sm text-gray-400">Början av delen</p>}
      <div className="card grid min-h-32 place-items-center text-center">{shown ? <LineText line={line} className="pop text-2xl leading-relaxed font-bold" /> : hint}</div>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        {!silent && (ex.type === 'sing' || !shown) && (
          <button className="btn-ghost py-2 text-sm" onClick={() => void clips.playLead(ex.section, ex.line)}>
            ▶ Spela fram till raden
          </button>
        )}
        {!silent && shown && (
          <button className="btn-ghost py-2 text-sm" onClick={() => void clips.playLine(ex.section, ex.line)}>
            ▶ Lyssna på raden
          </button>
        )}
      </div>
      <div className="mt-auto space-y-3 pt-8 pb-4">
        {!shown ? (
          <button
            className="btn-primary w-full"
            onClick={() => {
              setShown(true)
              void clips.playLine(ex.section, ex.line)
            }}
          >
            Visa raden
          </button>
        ) : (
          !answered && (
            <>
              <p className="text-center font-bold text-gray-600">Hur gick det?</p>
              <div className="grid grid-cols-3 gap-2">
                <button className="btn border-2 border-warm-100 bg-white py-3 text-amber-700" onClick={() => onResult({ grade: Rating.Again })}>
                  Inte än
                </button>
                <button className="btn border-2 border-brand-100 bg-white py-3 text-brand-700" onClick={() => onResult({ grade: Rating.Hard })}>
                  Nästan
                </button>
                <button className="btn-good py-3" onClick={() => onResult({ grade: Rating.Good })}>
                  Satt! 🎉
                </button>
              </div>
            </>
          )
        )}
      </div>
    </>
  )
}
