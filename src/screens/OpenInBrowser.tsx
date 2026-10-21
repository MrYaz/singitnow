import { useEffect, useState } from 'react'
import { externalUrl, isIOS } from '../lib/inapp'

/** Shown when the app is opened inside a social app's own browser. */
export default function OpenInBrowser() {
  const href = location.href
  const [copied, setCopied] = useState(false)
  const ios = isIOS()

  // Try to jump to the normal browser straight away; the page stays as a fallback.
  useEffect(() => {
    location.href = externalUrl(href)
  }, [href])

  return (
    <main className="mx-auto flex min-h-full max-w-md flex-col justify-center gap-5 px-6 py-10 text-center">
      <div className="text-6xl">🎶</div>
      <h1 className="text-3xl font-black text-brand-700">Öppna i webbläsaren</h1>
      <p className="text-lg text-gray-700">
        SingItNow fungerar bäst i telefonens vanliga webbläsare. Där sparas låtarna och ljudet spelas som det ska.
      </p>
      <a className="btn-primary block py-4 text-lg" href={externalUrl(href)}>
        Öppna i {ios ? 'Safari' : 'webbläsaren'}
      </a>
      <div className="card space-y-2 text-left text-base text-gray-700">
        <p className="font-black">Händer inget?</p>
        <p>
          Tryck på <b>⋯</b> eller <b>⋮</b> uppe i hörnet och välj <b>{ios ? 'Öppna i Safari' : 'Öppna i webbläsare'}</b>.
        </p>
        <p>Eller kopiera länken och klistra in den i webbläsaren.</p>
        <button
          className="btn-ghost w-full"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(href)
              setCopied(true)
            } catch {
              prompt('Kopiera länken:', href)
            }
          }}
        >
          {copied ? '✓ Länken är kopierad' : 'Kopiera länken'}
        </button>
      </div>
    </main>
  )
}
