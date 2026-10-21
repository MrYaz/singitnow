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
if (!inApp) void requestPersistence()

createRoot(document.getElementById('root')!).render(<StrictMode>{inApp ? <OpenInBrowser /> : <App />}</StrictMode>)
