import { useEffect, useRef, useState } from 'react'
import { importSources } from '../lib/importer'
import { DRIVE_KEY, cleanDriveUrl, fromFileList, driveFolderId, listDriveFolder, takeLinkedDrive, type SourceFile } from '../lib/sources'
import { saveSettings } from '../lib/learn'
import { useSettings } from '../settings'
import { Bar } from './ui'

export function ImportPanel({ onDone, onBusy }: { onDone?: () => void; onBusy?: (busy: boolean) => void }) {
  const { settings, reload } = useSettings()
  const [url, setUrl] = useState(settings.driveUrl)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [pct, setPct] = useState(0)
  const [err, setErr] = useState('')
  const folderRef = useRef<HTMLInputElement>(null)
  const filesRef = useRef<HTMLInputElement>(null)

  const run = async (get: () => Promise<SourceFile[]>, force = false) => {
    setBusy(true)
    onBusy?.(true)
    setErr('')
    try {
      setMsg('Letar efter låtar…')
      const files = await get()
      const songs = await importSources(
        files,
        (m, done, total) => {
          setMsg(m)
          setPct(done / total)
        },
        force,
      )
      setMsg(songs.length ? `Klart! ${songs.length} ${songs.length === 1 ? 'låt' : 'låtar'} inlästa.` : 'Inga nya låtar sedan sist.')
      setPct(1)
      onDone?.()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
      onBusy?.(false)
    }
  }

  const fromDrive = async () => {
    const id = driveFolderId(url)
    if (!id) {
      setErr('Det ser inte ut som en länk till en Drive-mapp.')
      return
    }
    // Keep only the folder id, so extras like ?usp=sharing or spaces never get in the way.
    const clean = cleanDriveUrl(id)
    setUrl(clean)
    await saveSettings({ driveUrl: clean })
    await reload()
    await run(() => listDriveFolder(clean))
  }

  // Opened from a link with the Drive folder in it: fetch the songs right away.
  useEffect(() => {
    if (DRIVE_KEY && settings.driveUrl && takeLinkedDrive()) void fromDrive()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="space-y-4">
      {DRIVE_KEY && (
        <div className="card space-y-3">
          <p className="font-extrabold">Länk till körens Drive-mapp</p>
          <p className="text-sm text-gray-600">Klistra in länken från välkomstbrevet. Nya låtar som körledaren lägger till hämtas automatiskt.</p>
          <input
            className="w-full rounded-xl border-2 border-brand-100 px-3 py-2 outline-none focus:border-brand-400"
            placeholder="https://drive.google.com/drive/folders/…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            inputMode="url"
          />
          <button className="btn-primary w-full" disabled={busy || !url.trim()} onClick={fromDrive}>
            Hämta låtarna
          </button>
        </div>
      )}
      <div className="card space-y-3">
        <p className="font-extrabold">{DRIVE_KEY ? 'Eller från telefonen/datorn' : 'Lägg till från telefonen/datorn'}</p>
        <p className="text-sm text-gray-600">Välj hela körmappen, eller markera alla mp3- och PDF-filer för en låt.</p>
        <div className="flex flex-wrap gap-2">
          <button className="btn-ghost flex-1" disabled={busy} onClick={() => folderRef.current?.click()}>
            Välj mapp
          </button>
          <button className="btn-ghost flex-1" disabled={busy} onClick={() => filesRef.current?.click()}>
            Välj filer
          </button>
        </div>
        <input
          ref={folderRef}
          type="file"
          className="hidden"
          // @ts-expect-error non-standard but widely supported
          webkitdirectory=""
          multiple
          onChange={(e) => e.target.files?.length && run(async () => fromFileList(e.target.files!))}
        />
        <input
          ref={filesRef}
          type="file"
          className="hidden"
          multiple
          accept=".mp3,.m4a,.wav,.pdf,audio/*,application/pdf"
          onChange={(e) => e.target.files?.length && run(async () => fromFileList(e.target.files!))}
        />
      </div>
      {(busy || msg) && (
        <div className="card space-y-2" aria-live="polite">
          <p className="font-bold">{msg}</p>
          {busy && <Bar value={pct} />}
          {busy && <p className="text-xs text-gray-500">Appen lyssnar igenom varje stämma för att hitta raderna. Det tar en liten stund per låt.</p>}
        </div>
      )}
      {err && <p className="rounded-2xl bg-warm-100 p-3 text-sm font-semibold text-amber-900">{err}</p>}
    </div>
  )
}
