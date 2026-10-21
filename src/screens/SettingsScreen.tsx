import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/db'
import { saveSettings } from '../lib/learn'
import { sortVoices } from '../lib/names'
import { importSources } from '../lib/importer'
import { DRIVE_KEY, listDriveFolder } from '../lib/sources'
import { useNav } from '../nav'
import { useSettings } from '../settings'
import { ImportPanel } from '../components/ImportPanel'
import { TopBar } from '../components/ui'
import { VoicePicker } from '../components/VoicePicker'

export default function SettingsScreen() {
  const nav = useNav()
  const { settings, reload } = useSettings()
  const songs = useLiveQuery(() => db.songs.orderBy('order').toArray(), [])
  const [msg, setMsg] = useState('')
  const voices = sortVoices([...new Set((songs ?? []).flatMap((s) => Object.keys(s.voices)))])
  const set = async (p: Parameters<typeof saveSettings>[0]) => {
    await saveSettings(p)
    await reload()
  }

  const reanalyze = async () => {
    const files = await db.files.toArray()
    const sources = files.map((f) => ({ id: f.id, path: [] as string[], name: f.name, size: f.size, modified: f.modified, load: async () => f.blob }))
    // Rebuild folder structure from the stored song ids so grouping matches the original import.
    const bySong = new Map(songs?.map((s) => [s.id, s.folder]))
    for (const s of sources) s.path = [bySong.get(files.find((f) => f.id === s.id)!.songId) ?? '']
    try {
      await importSources(sources, (m) => setMsg(m), true)
      setMsg('Alla låtar är analyserade igen.')
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <>
      <TopBar title="Inställningar" />
      <main className="space-y-6 px-4 pb-16">
        <section className="space-y-3">
          <h2 className="font-black">Mina stämmor</h2>
          <VoicePicker all={voices} value={settings.voices} cols={3} onChange={(v) => v.length && set({ voices: v })} />
        </section>
        <section className="space-y-3">
          <h2 className="font-black">Ditt namn</h2>
          <input
            className="w-full rounded-2xl border-2 border-brand-100 bg-white px-4 py-2.5 outline-none focus:border-brand-400"
            placeholder="Ditt förnamn"
            autoComplete="given-name"
            defaultValue={settings.name}
            onBlur={(e) => e.target.value.trim() !== settings.name && set({ name: e.target.value.trim() })}
          />
        </section>
        <section className="space-y-3">
          <h2 className="font-black">Dagsmål</h2>
          <div className="grid grid-cols-3 gap-2">
            {[
              [30, 'Lugnt'],
              [50, 'Lagom'],
              [100, 'Peppad'],
            ].map(([xp, label]) => (
              <button key={xp} className={`${settings.dailyGoal === xp ? 'btn-primary' : 'btn-ghost'} flex-col px-2 py-2 text-sm`} onClick={() => set({ dailyGoal: xp as number })}>
                {label}
                <span className="text-xs opacity-75">{xp} XP</span>
              </button>
            ))}
          </div>
        </section>
        <label className="card flex items-center gap-3">
          <span className="flex-1">
            <span className="block font-black">Tyst läge som standard</span>
            <span className="text-sm text-gray-600">Övningar utan ljud, till exempel på bussen.</span>
          </span>
          <input type="checkbox" className="h-6 w-6 accent-brand-600" checked={settings.silent} onChange={(e) => set({ silent: e.target.checked })} />
        </label>

        <section className="space-y-3">
          <h2 className="font-black">Låtar</h2>
          {DRIVE_KEY && settings.driveUrl && (
            <button
              className="btn-ghost w-full"
              onClick={async () => {
                setMsg('Letar efter nya låtar…')
                try {
                  const n = await importSources(await listDriveFolder(settings.driveUrl), (m) => setMsg(m))
                  setMsg(n.length ? `${n.length} låtar uppdaterade.` : 'Inga nya låtar.')
                } catch (e) {
                  setMsg(e instanceof Error ? e.message : String(e))
                }
              }}
            >
              Leta efter nya låtar i Drive
            </button>
          )}
          <ul className="space-y-2">
            {songs?.map((s) => (
              <li key={s.id} className="card flex items-center gap-2 py-3">
                <span className="flex-1 font-bold">{s.title}</span>
                <button className="rounded-full bg-brand-100 px-3 py-1 text-xs font-extrabold text-brand-700" onClick={() => nav.go({ name: 'tune', songId: s.id })}>
                  Justera tider
                </button>
              </li>
            ))}
          </ul>
          <button className="btn-ghost w-full" onClick={reanalyze}>
            Analysera alla låtar igen
          </button>
          {msg && <p className="text-sm font-bold text-brand-700">{msg}</p>}
        </section>

        <section className="space-y-3">
          <h2 className="font-black">Lägg till material</h2>
          <ImportPanel />
        </section>

        <section className="space-y-2">
          <button
            className="w-full rounded-2xl border-2 border-red-100 py-3 font-bold text-red-600"
            onClick={async () => {
              if (!confirm('Radera alla låtar och all statistik på den här enheten?')) return
              await db.delete()
              location.reload()
            }}
          >
            Radera allt på den här enheten
          </button>
          <p className="text-center text-xs text-gray-400">Allt sparas bara i din telefon. Inget laddas upp någonstans.</p>
        </section>
      </main>
    </>
  )
}
