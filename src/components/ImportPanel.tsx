import { useEffect, useRef, useState } from 'react'
import { ImportError, addSongs, canWaitToFetch, importSources, type Step } from '../lib/importer'
import { DRIVE_KEY, cleanDriveUrl, fromFileList, driveFolderId, listDriveFolder, takeLinkedDrive, type SourceFile } from '../lib/sources'
import { saveSettings } from '../lib/learn'
import { useSettings } from '../settings'
import { Bar } from './ui'
import { folderTitle } from '../lib/group'

export function ImportPanel({ onDone, onBusy }: { onDone?: () => void; onBusy?: (busy: boolean) => void }) {
  const { settings, reload } = useSettings()
  const [url, setUrl] = useState(settings.driveUrl)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  /** Reading the song list takes seconds; downloading and analysing takes minutes. The box says which. */
  const [phase, setPhase] = useState<'list' | 'analyse'>('list')
  const [pct, setPct] = useState(0)
  const [err, setErr] = useState('')
  const [failed, setFailed] = useState<{ name: string; url?: string }[]>([])
  const folderRef = useRef<HTMLInputElement>(null)
  const filesRef = useRef<HTMLInputElement>(null)

  /** `get` reads the files, and may name each song it finds along the way. */
  const run = async (get: (found: (folder: string, done: number, total: number) => void) => Promise<SourceFile[]>, force = false) => {
    setBusy(true)
    onBusy?.(true)
    setErr('')
    setFailed([])
    try {
      setMsg('Letar efter låtar…')
      setPhase('list')
      setPct(0)
      // The song titles flash past as the folders are read.
      const files = await get((folder, done, total) => {
        setMsg(folderTitle(folder))
        setPct(total ? done / total : 0)
      })
      if (canWaitToFetch(files) && !force) {
        // From Drive only the list is read now; each song downloads the first time it is opened.
        const noted = await addSongs(files)
        setMsg(noted.length ? `Klart! ${noted.length} ${noted.length === 1 ? 'låt' : 'låtar'} hittade. Varje låt hämtas första gången du öppnar den.` : 'Inga nya låtar sedan sist.')
        setPct(1)
        // A moment at 100 %, so the box does not vanish the instant it is done.
        await new Promise((r) => setTimeout(r, 900))
        onDone?.()
        return
      }
      setPhase('analyse')
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
      await new Promise((r) => setTimeout(r, 900))
      onDone?.()
    } catch (e) {
      setMsg('')
      setErr(e instanceof Error ? e.message : String(e))
      if (e instanceof ImportError) setFailed(e.failed.filter((f) => f.url))
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
    await run((found) => listDriveFolder(clean, undefined, found))
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
          <p className="text-sm text-gray-600">Klistra in länken från välkomstbrevet. Appen läser in låtlistan direkt, och varje låt laddas ner första gången du öppnar den. Nya låtar som körledaren lägger till dyker upp av sig själva.</p>
          <input
            className="w-full rounded-xl border-2 border-brand-100 px-3 py-2 outline-none focus:border-brand-400"
            placeholder="https://drive.google.com/drive/folders/…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            inputMode="url"
          />
          <button className="btn-primary w-full" disabled={busy || !url.trim()} onClick={fromDrive}>
            Hämta låtlistan
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
      {busy && <ImportProgress text={msg} share={pct} kind={phase} />}
      {!busy && msg && (
        <div className="card" aria-live="polite">
          <p className="font-bold">{msg}</p>
        </div>
      )}
      {err && (
        <div className="space-y-2 rounded-2xl bg-warm-100 p-3 text-sm font-semibold text-amber-900">
          <p>{err}</p>
          {failed.length > 0 && (
            <div className="space-y-1 text-xs font-normal">
              <p>För felsökning: länken visar vad Google svarar på filen som inte kom fram. Står det "We're sorry" är ditt nätverk tillfälligt spärrat. Laddas filen ner fungerar det igen.</p>
              {failed.map((f) => (
                // unsafe-url sends the app's address along, which the API key needs.
                <a key={f.name} className="block font-bold underline" href={f.url} target="_blank" rel="noopener" referrerPolicy="unsafe-url">
                  Visa Googles svar för {f.name}
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** Import progress over the page, so you see it has started without scrolling. Used on the start page and in the settings. */
export function ImportProgress({
  text,
  share,
  summary,
  onCancel,
  kind = 'fetch',
  steps,
}: {
  text: string
  share: number
  summary?: string
  onCancel?: () => void
  /** list: only the song list is read. fetch: download, analysis and exact timing. analyse: analysis, with the exact timing left for later. */
  kind?: 'list' | 'fetch' | 'analyse'
  /** The parts of the job, each with its own bar, in place of one bar for everything. */
  steps?: Step[]
}) {
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/30 px-4" role="dialog" aria-modal="true" aria-label="Hämtar låtarna">
      <div className="pop card w-full max-w-md space-y-2 shadow-xl" aria-live="polite">
        {summary && <p className="text-sm font-black text-brand-700">{summary}</p>}
        {steps ? (
          <SteppedBar steps={steps} />        ) : (
          <>
            <p className="font-bold">{text}</p>
            <Bar value={share} />
          </>
        )}
        {kind !== 'list' && (
          <>
            <p className="text-xs text-gray-500">
              {kind === 'fetch'
                ? 'Appen hämtar låten, lyssnar igenom varje stämma och synkar texten exakt. Det tar en stund per låt, längre på äldre telefoner och plattor.'
                : 'Appen lyssnar igenom varje stämma för att hitta raderna. Den exakta synken görs sedan i bakgrunden.'}
            </p>
            <p className="rounded-xl bg-brand-50 p-2 text-xs font-bold text-brand-700">
              💡 Ha webbläsaren framme med appen öppen tills allt är klart. Byter du app eller flik, eller släcks skärmen, stannar det. Appen håller skärmen tänd så länge.
            </p>
          </>
        )}
        {onCancel && (
          <button className="btn-ghost w-full" onClick={onCancel}>
            Avbryt och fortsätt senare
          </button>
        )}
      </div>
    </div>
  )
}

/** One bar cut into a segment per step (download, speech model, each voice), each filling on its own. */
function SteppedBar({ steps }: { steps: Step[] }) {
  const now = steps.find((st) => st.share < 1 && !st.failed) ?? steps.at(-1)!
  const all = steps.every((st) => st.share >= 1 || st.failed)
  return (
    <div className="space-y-1.5">
      <p className="font-bold">
        {all ? (
          'Klart! ✓'
        ) : (
          <>
            {now.label} <span className="text-sm text-gray-500 tabular-nums">{Math.round(now.share * 100)} %</span>
          </>
        )}
      </p>
      <div className="flex gap-1" role="progressbar" aria-label={now.label} aria-valuenow={Math.round(now.share * 100)}>
        {steps.map((st) => (
          <div key={st.label} className="h-3 flex-1 overflow-hidden rounded-full bg-brand-100" title={st.label}>
            <div className={`h-full rounded-full transition-all ${st.failed ? 'bg-gray-300' : 'bg-brand-500'}`} style={{ width: `${(st.failed ? 1 : st.share) * 100}%` }} />
          </div>
        ))}
      </div>
      {now.note && <p className="text-xs text-gray-500">{now.note}</p>}
    </div>
  )
}
