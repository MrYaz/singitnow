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
  const songs = useLiveQuery(() => db.songs.toArray(), [])
  const [busy, setBusy] = useState(false)
  const voices = sortVoices([...new Set((songs ?? []).flatMap((s) => Object.keys(s.voices)))])

  const [picked, setPicked] = useState<string[]>(settings.voices)
  const done = async () => {
    await saveSettings({ voices: picked })
    await reload()
  }

  return (
    <main className="space-y-5 px-4 pt-[max(env(safe-area-inset-top),24px)] pb-10">
      <div className="pop text-center">
        <div className="text-6xl">🎶</div>
        <h1 className="mt-2 text-3xl font-black text-brand-700">SingItNow</h1>
        <p className="mt-2 text-gray-600">Lär dig texterna utantill, en formdel i taget, så att du kan sjunga fritt med hela kroppen. Inga krav, bara glädje.</p>
      </div>

      {!songs?.length || busy ? (
        <>
          <h2 className="text-xl font-extrabold">1. Lägg till körens låtar</h2>
          <ImportPanel onBusy={setBusy} />
        </>
      ) : (
        <>
          <p className="card font-bold text-good-600">✓ {songs.length} låtar inlästa</p>
          <h2 className="text-xl font-extrabold">2. Vilken stämma sjunger du?</h2>
          <p className="text-sm text-gray-600">Osäker? Välj den som känns mest bekväm. Du kan byta när som helst.</p>
          <VoicePicker all={voices} value={picked} onChange={setPicked} />
          <button className="btn-primary w-full" disabled={!picked.length} onClick={done}>
            Kör igång
          </button>
        </>
      )}
    </main>
  )
}
