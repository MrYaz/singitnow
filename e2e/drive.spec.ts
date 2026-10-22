import { expect, test, type Page } from '@playwright/test'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

// Imports from a fake Google Drive served from local material. Needs a build made with VITE_GOOGLE_API_KEY set.
const DIR = process.env.MATERIAL_DIR
// The app's service worker would hide Drive requests from page.route.
test.use({ serviceWorkers: 'block' })
test.skip(!DIR || !existsSync(DIR) || !process.env.VITE_GOOGLE_API_KEY, 'MATERIAL_DIR or VITE_GOOGLE_API_KEY not set')

type Item = { id: string; name: string; mimeType: string; size?: string; modifiedTime?: string; path?: string; parent: string }

function fakeDrive(songFolders: string[]): Item[] {
  const items: Item[] = []
  // Stable, unique ids from the path, so a song keeps its ids between listings.
  const idOf = (p: string) => 'id' + createHash('sha1').update(p).digest('hex')
  const walk = (dir: string, parent: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      const id = idOf(p)
      if (statSync(p).isDirectory()) {
        items.push({ id, name, mimeType: 'application/vnd.google-apps.folder', parent })
        walk(p, id)
      } else items.push({ id, name, mimeType: 'audio/mpeg', size: String(statSync(p).size), modifiedTime: '2026-10-01T00:00:00Z', path: p, parent })
    }
  }
  for (const f of songFolders) {
    const id = idOf(f)
    items.push({ id, name: f, mimeType: 'application/vnd.google-apps.folder', parent: 'ROOTFOLDER12345678901' })
    walk(join(DIR!, f), id)
  }
  return items
}

async function serve(page: Page, songFolders: string[], refuse = 0) {
  const items = fakeDrive(songFolders)
  // The first `refuse` downloads get an answer without CORS headers, like Google's throttling.
  let refused = 0
  await page.route(/googleapis\.com\/drive\/v3\/files/, async (route) => {
    const url = new URL(route.request().url())
    const cors = { 'access-control-allow-origin': '*' }
    const fileId = url.pathname.split('/files/')[1]
    if (fileId) {
      if (refused < refuse) {
        refused++
        return route.fulfill({ status: 429, body: 'Too many requests' })
      }
      const it = items.find((x) => x.id === fileId)!
      return route.fulfill({ status: 200, headers: cors, body: readFileSync(it.path!) })
    }
    const parent = url.searchParams.get('q')!.match(/'([^']+)' in parents/)![1]
    const files = items.filter((x) => x.parent === parent).map(({ id, name, mimeType, size, modifiedTime }) => ({ id, name, mimeType, size, modifiedTime }))
    return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ files }) })
  })
}

test('asks before fetching new songs from Drive', async ({ page }) => {
  const songs = readdirSync(DIR!).sort()
  await serve(page, songs.slice(0, 1))
  // A shared link starts the import by itself.
  await page.goto('./?drive=ROOTFOLDER12345678901')
  await expect(page.getByText('✓ 1 låt inlästa')).toBeVisible({ timeout: 600_000 })
  await page.getByRole('button', { name: 'Alt 2', exact: true }).click()
  await page.getByPlaceholder('Ditt förnamn').fill('Ella')
  await page.getByRole('button', { name: 'Kör igång' }).click()
  await expect(page.getByText('Dagens pass')).toBeVisible()

  // A new song turns up in the folder: the app asks on the next start.
  await page.unrouteAll()
  await serve(page, songs)
  await page.reload()
  await expect(page.getByText('Det har kommit nytt i körens mapp')).toBeVisible()
  await expect(page.getByText('Ny', { exact: true })).toBeVisible()
  await page.screenshot({ path: 'test-results/drive-offer.png' })
  await page.getByRole('button', { name: 'Hämta' }).click()
  await expect(page.getByText(/1 låt hämtade från Drive!/)).toBeVisible({ timeout: 600_000 })

  // Nothing new: no question.
  await page.reload()
  await expect(page.getByText('Dagens pass')).toBeVisible()
  await page.waitForTimeout(1500)
  await expect(page.getByText('Det har kommit nytt i körens mapp')).toHaveCount(0)

  // Looking again from the settings: progress shows in the button.
  await page.getByRole('button', { name: 'Inställningar' }).click()
  await page.getByRole('button', { name: 'Leta efter nya låtar i Drive' }).click()
  await expect(page.getByText('Inga nya låtar.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Leta efter nya låtar i Drive' })).toBeEnabled()
})

test('a song Google turns away is tried again', async ({ page }) => {
  test.setTimeout(300_000)
  const songs = readdirSync(DIR!).sort()
  // Four refusals: the first file fails all its retries, so the song waits and is tried again.
  await serve(page, songs.slice(0, 1), 4)
  await page.goto('./?drive=ROOTFOLDER12345678901')
  await expect(page.getByText(/krånglade\. Försöker igen om/)).toBeVisible({ timeout: 120_000 })
  await expect(page.getByText('✓ 1 låt inlästa')).toBeVisible({ timeout: 180_000 })
})
