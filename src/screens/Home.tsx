import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/db'
import { doneFor, dueLines, getStreak, isDone, saveSettings, todayXP } from '../lib/learn'
import { LEVELS, learnable, lessonFor, reviewExercise } from '../lib/exercises'
import { pickVoice, shortVoice, sortVoices } from '../lib/names'
import { VoicePicker, voiceLabel } from '../components/VoicePicker'
import { ImportError, importSources, songsToFetch } from '../lib/importer'
import type { SourceFile } from '../lib/sources'
import { DRIVE_KEY, listDriveFolder, takeLinkedDrive } from '../lib/sources'
import { onRefineStatus, refineInBackground } from '../lib/refine'
import { useNav, type LessonItem } from '../nav'
import { useSettings } from '../settings'
import { Bar, Sheet } from '../components/ui'
import type { Song } from '../lib/types'

let checkedDrive = false

// Three equal buttons that still fit on a narrow phone.
const songBtn = 'btn-soft min-w-0 px-1 py-2.5 text-sm tracking-normal sm:text-base'

export default function Home() {
  const nav = useNav()
  const { settings, reload } = useSettings()
  const mine = settings.voices
  const songs = useLiveQuery(() => db.songs.orderBy('order').toArray(), [])
  const xp = useLiveQuery(() => todayXP(), [])
  const streak = useLiveQuery(() => getStreak(), [])
  const mineKey = mine.join('|')
  const due = useLiveQuery(() => dueLines(mine, 50), [mineKey])
  const levels = useLiveQuery(async () => {
    const out: Record<string, Record<number, number>> = {}
    for (const s of songs ?? []) {
      const v = pickVoice(s.voices, mine)
      out[s.id] = v ? await doneFor(s.id, v) : {}
    }
    return out
  }, [songs, mineKey])
  const [voiceSheet, setVoiceSheet] = useState(false)
  const [syncMsg, setSyncMsg] = useState('')
  const syncing = useRef(false)
  const [refine, setRefine] = useState<{ text: string; share: number } | null>(null)
  useEffect(() => onRefineStatus(setRefine), [])
  const mineRef = useRef(mine)
  mineRef.current = mine

  // Look for new songs in the choir's Drive folder once per app start, and ask before downloading them.
  const [offer, setOffer] = useState<{ files: SourceFile[]; songs: { name: string; isNew: boolean }[] } | null>(null)
  const [fetching, setFetching] = useState<{ msg: string; share: number } | null>(null)
  const refineLater = () => {
    syncing.current = false
    void refineInBackground((s) => pickVoice(s.voices, mineRef.current))
  }
  useEffect(() => {
    takeLinkedDrive() // Home checks the folder itself, so a shared link needs no extra import.
    if (checkedDrive || !DRIVE_KEY || !settings.driveUrl || !navigator.onLine) return
    checkedDrive = true
    syncing.current = true
    void (async () => {
      try {
        const files = await listDriveFolder(settings.driveUrl)
        const news = await songsToFetch(files)
        if (news.length) return setOffer({ files, songs: news })
      } catch {
        /* offline or Drive unavailable: try again next start */
      }
      refineLater()
    })()
  }, [settings.driveUrl])

  const fetchOffer = async () => {
    if (!offer) return
    setFetching({ msg: 'Hämtar…', share: 0 })
    let n = 0
    let err = ''
    try {
      n = (await importSources(offer.files, (msg, done, total) => setFetching({ msg, share: done / total }))).length
    } catch (e) {
      n = e instanceof ImportError ? e.imported.length : 0
      err = e instanceof Error ? e.message : String(e)
    }
    setFetching(null)
    setOffer(null)
    setSyncMsg(err || (n ? `${n} ${n === 1 ? 'låt' : 'låtar'} hämtade från Drive!` : ''))
    refineLater()
  }

  // Time the lines of your voices with the speech model, in the background.
  useEffect(() => {
    if (syncing.current || !songs?.length) return
    void refineInBackground((s) => pickVoice(s.voices, mineRef.current))
  }, [songs, mineKey])

  if (!songs || !levels) return null
  const allVoices = sortVoices([...new Set(songs.flatMap((s) => Object.keys(s.voices)))])
  const goal = settings.dailyGoal

  const voiceOf = (s: Song) => pickVoice(s.voices, mine)
  const progressOf = (s: Song) => {
    const vn = voiceOf(s)
    const v = vn ? s.voices[vn] : null
    if (!v) return null
    const secs = learnable(v.sections)
    const lv = levels[s.id] ?? {}
    // A learning method counts as done when every part of the song is done with it.
    const methods = LEVELS.filter((_, m) => secs.length > 0 && secs.every((x) => isDone(lv[x.i], m))).length
    const steps = secs.reduce((a, x) => a + LEVELS.filter((_, m) => isDone(lv[x.i], m)).length, 0)
    return { done: methods, total: LEVELS.length, share: secs.length ? steps / (secs.length * LEVELS.length) : 0 }
  }

  // Next thing to learn: the first method not done on every part, at its first part not done.
  const next = (() => {
    for (const s of songs) {
      const vn = voiceOf(s)
      if (!vn) continue
      const secs = learnable(s.voices[vn].sections)
      for (let m = 0; m < LEVELS.length; m++) {
        const part = secs.find((x) => !isDone(levels[s.id]?.[x.i], m))
        if (part) return { song: s, voice: vn, section: part.i, level: m, started: secs.some((x) => (levels[s.id]?.[x.i] ?? 0) > 0) }
      }
    }
    return null
  })()

  const startDaily = () => {
    const items: LessonItem[] = []
    for (const row of due ?? []) {
      const [songId, voice, s, l] = row.key.split('|')
      const song = songs.find((x) => x.id === songId)
      if (!song || voiceOf(song) !== voice) continue
      const sections = song.voices[voice]?.sections
      if (!sections?.[Number(s)]?.lines[Number(l)]) continue
      items.push({ songId, voice, ex: reviewExercise(sections, Number(s), Number(l), row.card.reps, row.due % 997) })
      if (items.length >= 12) break
    }
    if (items.length) nav.go({ name: 'lesson', title: 'Dagens pass', items })
    else if (next) startNext()
  }

  const startNext = () => {
    if (!next) return
    nav.go(lessonFor(next.song, next.voice, next.section, next.level))
  }

  return (
    <main className={`px-4 pt-[max(env(safe-area-inset-top),16px)] ${refine ? 'pb-16' : 'pb-10'}`}>
      <div className="flex items-center gap-3">
        <div className="flex shrink-0 items-center gap-1 text-lg font-black whitespace-nowrap text-warm-500" title="Dagar i rad">
          🔥 {streak?.count ?? 0}
        </div>
        <div className="flex-1">
          <Bar value={(xp ?? 0) / goal} />
          <p className="mt-1 text-xs font-bold whitespace-nowrap text-gray-500">
            {xp ?? 0} / {goal} XP idag
          </p>
        </div>
        <button className="max-w-[45%] truncate rounded-full bg-brand-100 px-3 py-1.5 text-sm font-extrabold text-brand-700" aria-label={`Mina stämmor: ${voiceLabel(mine)}`} onClick={() => setVoiceSheet(true)}>
          {mine.length ? mine.map(shortVoice).join(' + ') : voiceLabel(mine)} ▾
        </button>
        <button aria-label="Inställningar" className="grid h-9 w-9 place-items-center rounded-full text-xl active:bg-brand-100" onClick={() => nav.go({ name: 'settings' })}>
          ⚙️
        </button>
      </div>

      <p className="mt-5 text-2xl font-black">{settings.name ? `Hej ${settings.name}! 👋` : 'Hej! 👋'}</p>
      <p className="text-sm text-gray-600">
        {(xp ?? 0) >= goal
          ? 'Dagsmålet är klart. Snyggt jobbat!'
          : (streak?.count ?? 0) > 1
            ? `${streak!.count} dagar i rad. Fortsätt så!`
            : 'Redo att sjunga? Lite varje dag gör stor skillnad.'}
      </p>

      <button className="card mt-4 flex w-full items-center gap-4 border-brand-200 bg-brand-600 text-left text-white shadow-[0_5px_0_#4c1d95] active:translate-y-0.5" onClick={startDaily}>
        <div className="text-4xl">✨</div>
        <div className="flex-1">
          <p className="text-xl font-black">Dagens pass</p>
          <p className="text-sm opacity-90">
            {due?.length
              ? `${due.length} rader att repetera, cirka ${Math.max(2, Math.round(Math.min(12, due.length) * 0.4))} min`
              : next
                ? `${next.started ? 'Fortsätt' : 'Börja'}: ${next.song.title}, ${LEVELS[next.level].name.toLowerCase()}`
                : 'Allt är repeterat. Snyggt jobbat!'}
          </p>
        </div>
      </button>

      {syncMsg && <p className="mt-3 rounded-2xl bg-good-100 p-3 text-sm font-bold text-good-600">{syncMsg}</p>}
      <h2 className="mt-7 mb-3 text-lg font-black">Låtar</h2>
      <ul className="space-y-3">
        {songs.map((s) => {
          const p = progressOf(s)
          return (
            <li key={s.id} className="card">
              <button className="w-full text-left" onClick={() => nav.go({ name: 'song', songId: s.id })}>
                <div className="flex items-center gap-2">
                  <p className="flex-1 text-lg font-extrabold">{s.title}</p>
                  {p && p.done === p.total && <span className="text-xl">👑</span>}
                </div>
                {p ? (
                  <>
                    <Bar value={p.share} className="mt-2 h-2" />
                    <p className="mt-1 text-xs font-bold text-gray-500">
                      {p.done} av {p.total} inlärningssätt klara
                    </p>
                  </>
                ) : (
                  <p className="text-xs text-gray-500">Ingen av dina stämmor finns i den här låten</p>
                )}
              </button>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <button className={songBtn} onClick={() => nav.go({ name: 'rehearsal', songId: s.id })}>
                  Stämrep
                </button>
                <button className={songBtn} disabled={!p} onClick={() => nav.go({ name: 'song', songId: s.id })}>
                  Textträning
                </button>
                <button className={songBtn} onClick={() => nav.go({ name: 'read', songId: s.id })}>
                  Körrep
                </button>
              </div>
            </li>
          )
        })}
      </ul>

      <Sheet
        open={!!offer}
        onClose={() => {
          if (fetching) return
          setOffer(null)
          refineLater()
        }}
      >
        {offer && (
          <div className="space-y-3">
            <p className="text-lg font-black">
              {offer.songs.length === 1 ? 'Det har kommit nytt i körens mapp' : `${offer.songs.length} låtar är nya eller ändrade i körens mapp`}
            </p>
            <ul className="space-y-1">
              {offer.songs.map((x) => (
                <li key={x.name} className="flex items-center gap-2 font-bold">
                  <span>🎵</span>
                  <span className="flex-1">{x.name}</span>
                  <span className="text-xs font-semibold text-gray-500">{x.isNew ? 'Ny' : 'Uppdaterad'}</span>
                </li>
              ))}
            </ul>
            {fetching ? (
              <div className="space-y-2" aria-live="polite">
                <p className="text-sm font-bold">{fetching.msg}</p>
                <Bar value={fetching.share} />
              </div>
            ) : (
              <div className="flex gap-2 pt-1">
                <button
                  className="btn-ghost flex-1"
                  onClick={() => {
                    setOffer(null)
                    refineLater()
                  }}
                >
                  Inte nu
                </button>
                <button className="btn-primary flex-1" onClick={fetchOffer}>
                  Hämta
                </button>
              </div>
            )}
          </div>
        )}
      </Sheet>

      <Sheet open={voiceSheet} onClose={() => setVoiceSheet(false)}>
        <p className="mb-3 text-lg font-black">Mina stämmor</p>
        <VoicePicker
          all={allVoices}
          value={mine}
          onChange={async (v) => {
            if (!v.length) return
            await saveSettings({ voices: v })
            await reload()
          }}
        />
        <p className="mt-3 text-xs text-gray-500">Varje stämma har sina egna framsteg.</p>
      </Sheet>

      {refine && (
        <p className="fixed inset-x-0 bottom-0 bg-white/90 px-4 pt-1.5 pb-[max(env(safe-area-inset-bottom),6px)] text-center text-xs text-gray-500 backdrop-blur" aria-live="polite" title={refine.text}>
          Finjusterar synken i bakgrunden, du kan fortsätta att öva. {Math.round(refine.share * 100)} %
        </p>
      )}
    </main>
  )
}
