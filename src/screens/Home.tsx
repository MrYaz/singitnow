import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/db'
import { dueLines, getStreak, levelsFor, saveSettings, todayXP } from '../lib/learn'
import { LEVELS, learnable, reviewExercise, buildLesson } from '../lib/exercises'
import { sortVoices } from '../lib/names'
import { importSources } from '../lib/importer'
import { DRIVE_KEY, listDriveFolder } from '../lib/sources'
import { useNav, type LessonItem } from '../nav'
import { useSettings } from '../settings'
import { Bar, Sheet } from '../components/ui'
import type { Song } from '../lib/types'

let checkedDrive = false

export default function Home() {
  const nav = useNav()
  const { settings, reload } = useSettings()
  const voice = settings.voice!
  const songs = useLiveQuery(() => db.songs.orderBy('order').toArray(), [])
  const xp = useLiveQuery(() => todayXP(), [])
  const streak = useLiveQuery(() => getStreak(), [])
  const due = useLiveQuery(() => dueLines(voice, 50), [voice])
  const levels = useLiveQuery(async () => {
    const out: Record<string, Record<number, number>> = {}
    for (const s of songs ?? []) out[s.id] = await levelsFor(s.id, voice)
    return out
  }, [songs, voice])
  const [voiceSheet, setVoiceSheet] = useState(false)
  const [syncMsg, setSyncMsg] = useState('')
  const syncing = useRef(false)

  // Look for new songs in the choir's Drive folder once per app start.
  useEffect(() => {
    if (checkedDrive || !DRIVE_KEY || !settings.driveUrl || !navigator.onLine) return
    checkedDrive = true
    syncing.current = true
    void (async () => {
      try {
        const files = await listDriveFolder(settings.driveUrl)
        const added = await importSources(files, (m) => setSyncMsg(m))
        setSyncMsg(added.length ? `${added.length} ny${added.length === 1 ? '' : 'a'} låt${added.length === 1 ? '' : 'ar'} från Drive!` : '')
      } catch {
        setSyncMsg('')
      } finally {
        syncing.current = false
      }
    })()
  }, [settings.driveUrl])

  if (!songs || !levels) return null
  const allVoices = sortVoices([...new Set(songs.flatMap((s) => Object.keys(s.voices)))])
  const goal = settings.dailyGoal

  const progressOf = (s: Song) => {
    const v = s.voices[voice]
    if (!v) return null
    const secs = learnable(v.sections)
    const lv = levels[s.id] ?? {}
    const done = secs.filter((x) => (lv[x.i] ?? 0) >= LEVELS.length).length
    const steps = secs.reduce((a, x) => a + Math.min(LEVELS.length, lv[x.i] ?? 0), 0)
    return { done, total: secs.length, share: secs.length ? steps / (secs.length * LEVELS.length) : 0 }
  }

  // Next thing to learn: the first section that is not finished.
  const next = (() => {
    for (const s of songs) {
      const v = s.voices[voice]
      if (!v) continue
      for (const { i } of learnable(v.sections)) {
        const lv = levels[s.id]?.[i] ?? 0
        if (lv < LEVELS.length) return { song: s, section: i, level: lv }
      }
    }
    return null
  })()

  const startDaily = () => {
    const items: LessonItem[] = []
    for (const row of due ?? []) {
      const [songId, , s, l] = row.key.split('|')
      const song = songs.find((x) => x.id === songId)
      const sections = song?.voices[voice]?.sections
      if (!sections?.[Number(s)]?.lines[Number(l)]) continue
      items.push({ songId, voice, ex: reviewExercise(sections, Number(s), Number(l), row.card.reps, row.due % 997) })
      if (items.length >= 12) break
    }
    if (items.length) nav.go({ name: 'lesson', title: 'Dagens pass', items })
    else if (next) startNext()
  }

  const startNext = () => {
    if (!next) return
    const sections = next.song.voices[voice].sections
    nav.go({
      name: 'lesson',
      title: `${next.song.title} · ${LEVELS[next.level].name}`,
      items: buildLesson(sections, next.section, next.level).map((ex) => ({ songId: next.song.id, voice, ex })),
      level: { songId: next.song.id, voice, section: next.section, level: next.level },
    })
  }

  return (
    <main className="px-4 pt-[max(env(safe-area-inset-top),16px)] pb-10">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1 text-lg font-black text-warm-500" title="Dagar i rad">
          🔥 {streak?.count ?? 0}
        </div>
        <div className="flex-1">
          <Bar value={(xp ?? 0) / goal} />
          <p className="mt-1 text-xs font-bold text-gray-500">
            {xp ?? 0} / {goal} XP idag
          </p>
        </div>
        <button className="rounded-full bg-brand-100 px-3 py-1.5 text-sm font-extrabold text-brand-700" onClick={() => setVoiceSheet(true)}>
          {voice} ▾
        </button>
        <button aria-label="Inställningar" className="grid h-9 w-9 place-items-center rounded-full text-xl active:bg-brand-100" onClick={() => nav.go({ name: 'settings' })}>
          ⚙️
        </button>
      </div>

      <button className="card mt-5 flex w-full items-center gap-4 border-brand-200 bg-brand-600 text-left text-white shadow-[0_5px_0_#4c1d95] active:translate-y-0.5" onClick={startDaily}>
        <div className="text-4xl">✨</div>
        <div className="flex-1">
          <p className="text-xl font-black">Dagens pass</p>
          <p className="text-sm opacity-90">
            {due?.length
              ? `${due.length} rader att repetera, cirka ${Math.max(2, Math.round(Math.min(12, due.length) * 0.4))} min`
              : next
                ? `Fortsätt: ${next.song.title}, ${LEVELS[next.level].name.toLowerCase()}`
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
                  {p && p.total > 0 && p.done === p.total && <span className="text-xl">👑</span>}
                </div>
                {p ? (
                  <>
                    <Bar value={p.share} className="mt-2 h-2" />
                    <p className="mt-1 text-xs font-bold text-gray-500">
                      {p.done} av {p.total} delar klara
                    </p>
                  </>
                ) : (
                  <p className="text-xs text-gray-500">Ingen {voice}-stämma i den här låten</p>
                )}
              </button>
              <div className="mt-3 flex gap-2">
                <button className="btn-primary flex-1 py-2" disabled={!p} onClick={() => nav.go({ name: 'song', songId: s.id })}>
                  Lär dig
                </button>
                <button className="btn-ghost flex-1 py-2" onClick={() => nav.go({ name: 'rehearsal', songId: s.id })}>
                  Stämrep
                </button>
              </div>
            </li>
          )
        })}
      </ul>

      <Sheet open={voiceSheet} onClose={() => setVoiceSheet(false)}>
        <p className="mb-3 text-lg font-black">Byt stämma</p>
        <div className="grid grid-cols-2 gap-3">
          {allVoices.map((v) => (
            <button
              key={v}
              className={v === voice ? 'btn-primary' : 'btn-ghost'}
              onClick={async () => {
                await saveSettings({ voice: v })
                await reload()
                setVoiceSheet(false)
              }}
            >
              {v}
            </button>
          ))}
        </div>
        <p className="mt-3 text-xs text-gray-500">Varje stämma har sina egna framsteg.</p>
      </Sheet>
    </main>
  )
}
