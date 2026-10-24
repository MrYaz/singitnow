import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { requestPersistence } from './lib/db'
import { inAppBrowser } from './lib/inapp'
import OpenInBrowser from './screens/OpenInBrowser'

// Inside Facebook, Instagram and similar apps, send the visitor on to the real browser first.
// This runs before the app reads ?drive= from the address, so the link survives the jump.
const inApp = inAppBrowser()
// The app always opens on the start page, so the browser should not put back an old scroll position
// on reload. It would do that before the songs have loaded, and land a little way down the page.
if ('scrollRestoration' in history) history.scrollRestoration = 'manual'
window.scrollTo(0, 0)
if (!inApp) void requestPersistence()

createRoot(document.getElementById('root')!).render(<StrictMode>{inApp ? <OpenInBrowser /> : <App />}</StrictMode>)
