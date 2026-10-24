import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/db'
import { doneFor, dueLines, getStreak, heardFor, isDone, saveSettings, todayXP } from '../lib/learn'
import { LEVELS, learnable, lessonFor, reviewExercise } from '../lib/exercises'
import { pickVoice, shortVoice, sortVoices } from '../lib/names'
import { VoicePicker, voiceLabel } from '../components/VoicePicker'
import { ImportError, addSongs, fetchAllSongs, fetchSong, type Step } from '../lib/importer'
import { DRIVE_KEY, listDriveFolder, takeLinkedDrive } from '../lib/sources'
import { onRefineStatus, refineInBackground } from '../lib/refine'
import { useNav, type LessonItem, type Screen } from '../nav'
import { useSettings } from '../settings'
import { Bar, Sheet } from '../components/ui'
import { ImportProgress } from '../components/ImportPanel'
import type { PendingSong, Song } from '../lib/types'

let checkedDrive = false

// Three equal buttons that still fit on a narrow phone.
const songBtn = 'btn-soft min-w-0 px-1 py-2.5 text-sm tracking-normal sm:text-base'

export default function Home() {
  const nav = useNav()
  const { settings, reload } = useSettings()
  const mine = settings.voices
  const songs = useLiveQuery(() => db.songs.orderBy('order').toArray(), [])
  // Noted songs, with what is left to download: a stopped download keeps the files it got.
  const pending = useLiveQuery(async () => {
    const rows = await db.pending.orderBy('order').toArray()
    const stored = new Map((await db.files.bulkGet(rows.flatMap((r) => r.files.map((f) => `drive:${f.driveId}`)))).filter((f) => !!f).map((f) => [f.id, f]))
    return rows.map((r) => ({
      ...r,
      size: r.files.reduce((a, f) => {
        const got = stored.get(`drive:${f.driveId}`)
        return got && got.modified === f.modified && got.size === f.size ? a : a + f.size
      }, 0),
    }))
  }, [])
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
  const heard = useLiveQuery(async () => {
    const out: Record<string, number[]> = {}
    for (const s of songs ?? []) {
      const v = pickVoice(s.voices, mine)
      out[s.id] = v ? await heardFor(s.id, v) : []
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

  // Look for new songs in the choir's Drive folder once per app start. Only the list is fetched;
  // each song is downloaded the first time it is opened.
  const [fetching, setFetching] = useState<{ msg: string; share: number; summary?: string; steps?: Step[] } | null>(null)
  const stopFetch = useRef<AbortController | null>(null)
  const stopTally = useRef({ got: 0, total: 0 })
  /** Stops at the next file or voice; what is already downloaded is kept for next time. */
  const cancelFetch = () => {
    stopFetch.current?.abort()
    setFetching(null)
    const { got, total } = stopTally.current
    if (total) setSyncMsg(`Hämtat ${got} av ${total} låtar. Tryck på Hämta alla för att fortsätta, eller öppna en låt.`)
  }
  const [fetchErr, setFetchErr] = useState<{ text: string; failed: { name: string; url?: string }[] } | null>(null)
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
        // Only songs not seen before are news; noted ones already have their card.
        const seen = new Set((await db.pending.toArray()).map((p) => p.id))
        const news = (await addSongs(files)).filter((x) => !x.update && !seen.has(x.id))
        if (news.length) setSyncMsg(news.length === 1 ? `Ny låt i körens mapp: ${news[0].title}!` : `${news.length} nya låtar i körens mapp!`)
      } catch {
        /* offline or Drive unavailable: try again next start */
      }
      refineLater()
    })()
  }, [settings.driveUrl])

  /** Downloads and analyses noted songs (one, or all), with progress over the page. */
  const fetchNow = async (id: string | null, then?: Screen) => {
    setFetchErr(null)
    setSyncMsg('')
    setFetching({ msg: 'Hämtar…', share: 0 })
    syncing.current = true
    const stop = new AbortController()
    stopFetch.current = stop
    // Counted over the whole song list, so going on after a stop still reads "3 av 7".
    const before = (songs ?? []).filter((x) => !(pending ?? []).some((p) => p.id === x.id)).length
    const tally = { got: before, total: 0 }
    stopTally.current = tally
    try {
      const title = (pending ?? []).find((p) => p.id === id)?.title
      if (id) await fetchSong(id, (msg, done, n, steps) => !stop.signal.aborted && setFetching({ msg, share: n ? done / n : 0, summary: title, steps }), stop.signal, mineRef.current)
      else
        await fetchAllSongs((msg, done, n, steps) => {
          tally.got = before + Math.floor(done)
          tally.total = before + n
          if (!stop.signal.aborted) setFetching({ msg, share: n ? done / n : 0, summary: `Hämtat ${tally.got} av ${tally.total} låtar`, steps })
        }, stop.signal, mineRef.current)
      if (stop.signal.aborted) return
      // A moment at 100 %, so the box does not vanish the instant it is done.
      setFetching((f) => f && { ...f, share: 1, msg: 'Klart!', steps: f.steps?.map((x) => ({ ...x, share: 1, note: undefined })) })
      await new Promise((r) => setTimeout(r, 1200))
      if (stop.signal.aborted) return
      setFetching(null)
      if (then) nav.go(then)
    } catch (e) {
      setFetching(null)
      if (stop.signal.aborted) return
      setFetchErr({ text: e instanceof Error ? e.message : String(e), failed: e instanceof ImportError ? e.failed.filter((f) => f.url) : [] })
    } finally {
      refineLater()
    }
  }

  // Time the lines of your voices with the speech model, in the background.
  useEffect(() => {
    if (syncing.current || !songs?.length) return
    void refineInBackground((s) => pickVoice(s.voices, mineRef.current))
  }, [songs, mineKey])

  if (!songs || !levels || !heard || !pending) return null
  const allVoices = sortVoices([...new Set([...songs.flatMap((s) => Object.keys(s.voices)), ...pending.flatMap((p) => p.voices)])])
  // Downloaded songs and songs only noted from Drive, in the folder's order.
  const list: { id: string; order: number; song?: Song; wait?: PendingSong }[] = [
    ...songs.map((song) => ({ id: song.id, order: song.order, song, wait: pending.find((p) => p.id === song.id) })),
    ...pending.filter((p) => !songs.some((x) => x.id === p.id)).map((wait) => ({ id: wait.id, order: wait.order, wait })),
  ].sort((a, b) => a.order - b.order)
  const waiting = pending.filter((p) => !songs.some((x) => x.id === p.id))
  const mb = (bytes: number) => `${Math.max(1, Math.round(bytes / 1e6))} MB`
  const goal = settings.dailyGoal

  const voiceOf = (s: Song) => pickVoice(s.voices, mine)
  const progressOf = (s: Song) => {
    const vn = voiceOf(s)
    const v = vn ? s.voices[vn] : null
    if (!v) return null
    const secs = learnable(v.sections)
    const lv = levels[s.id] ?? {}
    // Stämrep first, then each learning method. One counts as done when every part is done with it.
    const left = unheard(s).length
    const methods = LEVELS.filter((_, m) => secs.length > 0 && secs.every((x) => isDone(lv[x.i], m))).length + (secs.length > 0 && !left ? 1 : 0)
    const steps = secs.reduce((a, x) => a + LEVELS.filter((_, m) => isDone(lv[x.i], m)).length, 0) + secs.length - left
    return { done: methods, total: LEVELS.length + 1, share: secs.length ? steps / (secs.length * (LEVELS.length + 1)) : 0 }
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

  // Parts of your voice not yet played through in Stämrep (parts without timing cannot be).
  const unheard = (s: Song) => {
    const vn = voiceOf(s)
    if (!vn) return []
    return learnable(s.voices[vn].sections).filter((x) => x.s.start != null && x.s.end != null && !heard[s.id]?.includes(x.i))
  }

  /** Where a tap on a song card goes: the next step not done, Stämrep first and then Textträning. */
  const resume = (s: Song): Screen => {
    const vn = voiceOf(s)
    if (!vn) return { name: 'rehearsal', songId: s.id }
    const left = unheard(s)
    if (left.length) return { name: 'rehearsal', songId: s.id, part: left[0].i }
    const secs = learnable(s.voices[vn].sections)
    for (let m = 0; m < LEVELS.length; m++) {
      const part = secs.find((x) => !isDone(levels[s.id]?.[x.i], m))
      if (part) return lessonFor(s, vn, part.i, m)
    }
    return { name: 'song', songId: s.id }
  }

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
    // Like Sing It's own advice: first listen and sing along in Stämrep, then train the words.
    const lesson: Screen | null = items.length ? { name: 'lesson', title: 'Dagens pass', items } : next ? lessonFor(next.song, next.voice, next.section, next.level) : null
    if (lesson) {
      const songId = next?.song.id ?? items[0].songId
      const part = next ? next.section : Number(due!.find((r) => r.key.startsWith(items[0].songId + '|'))!.key.split('|')[2])
      nav.go({ name: 'rehearsal', songId, part, then: lesson })
    } else if (!songs.length && waiting[0]) void fetchNow(waiting[0].id, { name: 'song', songId: waiting[0].id })
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
                : songs.length
                  ? 'Allt är repeterat. Snyggt jobbat!'
                  : waiting.length
                    ? `Börja: ${waiting[0].title}`
                    : 'Allt är repeterat. Snyggt jobbat!'}
          </p>
        </div>
      </button>

      {syncMsg && <p className="mt-3 rounded-2xl bg-good-100 p-3 text-sm font-bold text-good-600">{syncMsg}</p>}
      <h2 className="mt-7 mb-3 text-lg font-black">Låtar</h2>
      {waiting.length > 0 && (
        <div className="-mt-1 mb-3 flex items-center gap-2 text-xs text-gray-500">
          <p className="flex-1">Låtarna hämtas första gången du öppnar dem. Du kan också hämta allt på en gång.</p>
          <button className="btn-ghost shrink-0 px-3 py-1.5 text-xs" onClick={() => void fetchNow(null)}>
            Hämta alla ({mb(waiting.reduce((a, p) => a + p.size, 0))})
          </button>
        </div>
      )}
      <ul className="space-y-3">
        {list.map(({ id, song: s, wait }) => {
          if (!s) {
            // Not downloaded yet: the first tap downloads and analyses it, then opens what you chose.
            const open = (then: Screen) => void fetchNow(id, then)
            return (
              <li key={id} className="card">
                <button className="w-full text-left" onClick={() => open({ name: 'rehearsal', songId: id })}>
                  <p className="text-lg font-extrabold">{wait!.title}</p>
                  <p className="mt-1 text-xs font-bold text-gray-500">Hämtas när du öppnar den · {mb(wait!.size)}</p>
                </button>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <button className={songBtn} onClick={() => open({ name: 'rehearsal', songId: id })}>
                    Stämrep
                  </button>
                  <button className={songBtn} onClick={() => open({ name: 'song', songId: id })}>
                    Textträning
                  </button>
                  <button className={songBtn} onClick={() => open({ name: 'read', songId: id })}>
                    Körrep
                  </button>
                </div>
              </li>
            )
          }
          const p = progressOf(s)
          return (
            <li key={s.id} className="card">
              <button className="w-full text-left" onClick={() => nav.go(resume(s))}>
                <div className="flex items-center gap-2">
                  <p className="flex-1 text-lg font-extrabold">{s.title}</p>
                  {p && p.done === p.total && <span className="text-xl">👑</span>}
                </div>
                {p ? (
                  <>
                    <Bar value={p.share} className="mt-2 h-2" />
                    <p className="mt-1 text-xs font-bold text-gray-500">
                      {p.done} av {p.total} moment klara
                    </p>
                  </>
                ) : (
                  <p className="text-xs text-gray-500">Ingen av dina stämmor finns i den här låten</p>
                )}
              </button>
              {wait && (
                <button className="mt-2 w-full rounded-xl bg-brand-50 px-3 py-1.5 text-left text-xs font-bold text-brand-700" onClick={() => void fetchNow(s.id)}>
                  Ny version i körens mapp · Tryck här för att hämta den ({mb(wait.size)})
                </button>
              )}
              <div className="mt-3 grid grid-cols-3 gap-2">
                <button className={songBtn} onClick={() => nav.go({ name: 'rehearsal', songId: s.id })}>
                  Stämrep{p && !unheard(s).length && ' ✓'}
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

      {fetching && <ImportProgress text={fetching.msg} share={fetching.share} summary={fetching.summary} steps={fetching.steps} onCancel={cancelFetch} />}
      {fetchErr && (
        <Sheet open onClose={() => setFetchErr(null)}>
          <div className="space-y-2 text-sm">
            <p className="font-semibold text-amber-900">{fetchErr.text}</p>
            {fetchErr.failed.map((f) => (
              // unsafe-url sends the app's address along, which the API key needs.
              <a key={f.name} className="block text-xs font-bold underline" href={f.url} target="_blank" rel="noopener" referrerPolicy="unsafe-url">
                Visa Googles svar för {f.name}
              </a>
            ))}
            <button className="btn-primary mt-2 w-full" onClick={() => setFetchErr(null)}>
              Okej
            </button>
          </div>
        </Sheet>
      )}

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
          Finsynkar texterna i bakgrunden, du kan fortsätta att öva. {Math.round(refine.share * 100)} %
        </p>
      )}
    </main>
  )
}
