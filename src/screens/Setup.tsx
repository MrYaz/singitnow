import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/db'
import { saveSettings } from '../lib/learn'
import { sortVoices } from '../lib/names'
import { useSettings } from '../settings'
import { ImportPanel } from '../components/ImportPanel'
import { VoicePicker } from '../components/VoicePicker'

export default function Setup() {
  const { settings, reload } = useSettings()
  // Downloaded songs and songs noted from Drive, which are downloaded when first opened.
  const songs = useLiveQuery(async () => {
    const got = await db.songs.toArray()
    const waiting = (await db.pending.toArray()).filter((p) => !got.some((s) => s.id === p.id))
    return [...got.map((s) => ({ voices: Object.keys(s.voices) })), ...waiting.map((p) => ({ voices: p.voices }))]
  }, [])
  const [busy, setBusy] = useState(false)
  const voices = sortVoices([...new Set((songs ?? []).flatMap((s) => s.voices))])

  const [picked, setPicked] = useState<string[]>(settings.voices)
  const [name, setName] = useState(settings.name)
  const done = async () => {
    await saveSettings({ voices: picked, name: name.trim() })
    await reload()
  }

  return (
    <main className="space-y-5 px-4 pt-[max(env(safe-area-inset-top),24px)] pb-10">
      <div className="pop text-center">
        <div className="text-6xl">🎶</div>
        <h1 className="mt-2 text-3xl font-black text-brand-700">SingItNow</h1>
        <p className="mt-2 text-gray-600">Öva in körens låtar hemma, så att du kan sjunga fritt med hela kroppen. Inga krav, bara glädje.</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="card">
          <p className="text-2xl">🎚️</p>
          <p className="mt-1 font-black">Stämrep</p>
          <p className="text-sm text-gray-600">Lyssna på din stämma eller ALLA, loopa en fras om och om igen och mixa stämmorna.</p>
        </div>
        <div className="card">
          <p className="text-2xl">✍️</p>
          <p className="mt-1 font-black">Textträning</p>
          <p className="text-sm text-gray-600">Lär dig texten utantill del för del, med sex olika inlärningssätt.</p>
        </div>
        <div className="card col-span-2">
          <p className="text-2xl">📖</p>
          <p className="mt-1 font-black">Körrep</p>
          <p className="text-sm text-gray-600">Bara texten, stor och lättläst på mobilen eller läsplattan, med allt från körens PDF:er.</p>
        </div>
      </div>

      {!songs?.length || busy ? (
        <>
          <h2 className="text-xl font-extrabold">1. Lägg till körens låtar</h2>
          <ImportPanel onBusy={setBusy} />
        </>
      ) : (
        <>
          <p className="card font-bold text-good-600">✓ {songs.length} {songs.length === 1 ? 'låt' : 'låtar'} hittade</p>
          <h2 className="text-xl font-extrabold">2. Vilken stämma sjunger du?</h2>
          <p className="text-sm text-gray-600">Osäker? Välj den som känns mest bekväm. Du kan byta när som helst.</p>
          <VoicePicker all={voices} value={picked} onChange={setPicked} />
          <h2 className="text-xl font-extrabold">3. Vad heter du?</h2>
          <input
            className="w-full rounded-2xl border-2 border-brand-100 bg-white px-4 py-3 text-lg outline-none focus:border-brand-400"
            placeholder="Ditt förnamn"
            autoComplete="given-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <p className="-mt-3 text-xs text-gray-500">För en personligare upplevelse. Namnet stannar i din telefon.</p>
          <button className="btn-primary w-full" disabled={!picked.length} onClick={done}>
            Kör igång
          </button>
        </>
      )}
    </main>
  )
}
