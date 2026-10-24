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

async function setUp(page: Page) {
  await page.getByRole('button', { name: 'Alt 2', exact: true }).click()
  await page.getByPlaceholder('Ditt förnamn').fill('Ella')
  await page.getByRole('button', { name: 'Kör igång' }).click()
  await expect(page.getByText('Dagens pass')).toBeVisible()
}

test('lists the songs first and fetches each one when it is opened', async ({ page }) => {
  const songs = readdirSync(DIR!).sort()
  // Count held screen locks, to check the screen stays on through the whole job.
  await page.addInitScript(() => {
    const w = window as unknown as { locks: number }
    w.locks = 0
    Object.defineProperty(navigator, 'wakeLock', {
      value: {
        request: async () => {
          w.locks++
          const s = { released: false, release: async () => (s.released ? undefined : ((s.released = true), w.locks--)) }
          return s
        },
      },
    })
  })
  await serve(page, songs.slice(0, 1))
  // A shared link reads the folder by itself. Only the list is fetched, so this is quick.
  await page.goto('./?drive=ROOTFOLDER12345678901')
  await expect(page.getByText('✓ 1 låt hittade')).toBeVisible({ timeout: 30_000 })
  // Reading the list is quick, so its box has no tips about long downloads.
  await expect(page.getByText('Ha webbläsaren framme')).toHaveCount(0)
  await setUp(page)
  await expect(page.getByText(/Hämtas när du öppnar den · \d+ MB/)).toBeVisible()
  await page.screenshot({ path: 'test-results/drive-waiting.png' })

  // Opening it downloads and analyses it, then shows what you chose.
  await page.getByRole('button', { name: 'Körrep' }).first().click()
  await expect(page.getByText('Ha webbläsaren framme')).toBeVisible()
  // The speech model times the lines as part of fetching.
  await expect(page.getByText(/^Finsynkar Alt 2/)).toBeVisible({ timeout: 300_000 })
  expect(await page.evaluate(() => (window as unknown as { locks: number }).locks)).toBeGreaterThan(0)
  await expect(page.getByText(/^Finsynkar Alt 2 [1-9]\d? %/)).toBeVisible({ timeout: 300_000 })
  await page.screenshot({ path: 'test-results/stepped.png' })
  // A moment at 100 % before the box closes.
  await expect(page.getByText('Klart! ✓')).toBeVisible({ timeout: 600_000 })
  await expect(page.getByRole('heading', { name: 'Körrep' })).toBeVisible({ timeout: 600_000 })
  // Körrep keeps the screen on by itself; back home every lock is let go.
  await page.goBack()
  await expect(page.getByText(/Hämtas när du öppnar den/)).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => (window as unknown as { locks: number }).locks)).toBe(0)

  // A new song turns up in the folder: it is listed on the next start, nothing is downloaded.
  await page.unrouteAll()
  await serve(page, songs)
  await page.reload()
  await expect(page.getByText(/Ny låt i körens mapp: /)).toBeVisible()
  await expect(page.getByText(/Hämtas när du öppnar den/)).toHaveCount(1)
  await page.getByRole('button', { name: 'Stämrep' }).nth(1).click()
  await expect(page.getByRole('button', { name: 'Dölj text' })).toBeVisible({ timeout: 600_000 })
  await page.goBack()

  // Looking again from the settings: nothing new.
  await page.getByRole('button', { name: 'Inställningar' }).click()
  await page.getByRole('button', { name: 'Leta efter nya låtar i Drive' }).click()
  await expect(page.getByText('Inga nya låtar.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Leta efter nya låtar i Drive' })).toBeEnabled()
})

test('a song Google turns away is tried again', async ({ page }) => {
  test.setTimeout(900_000)
  const songs = readdirSync(DIR!).sort()
  // Four refusals: the first file fails all its retries, so the song waits and is tried again.
  await serve(page, songs.slice(0, 1), 4)
  await page.goto('./?drive=ROOTFOLDER12345678901')
  await expect(page.getByText('✓ 1 låt hittade')).toBeVisible({ timeout: 30_000 })
  await setUp(page)
  await page.getByRole('button', { name: 'Körrep' }).first().click()
  await expect(page.getByText(/svarar inte just nu för .*Försöker igen om/)).toBeVisible({ timeout: 120_000 })
  await expect(page.getByRole('heading', { name: 'Körrep' })).toBeVisible({ timeout: 600_000 })
})

test('fetching all songs can be stopped and continued later', async ({ page }) => {
  const songs = readdirSync(DIR!).sort()
  await serve(page, songs)
  await page.goto('./?drive=ROOTFOLDER12345678901')
  await expect(page.getByText(`✓ ${songs.length} låtar hittade`)).toBeVisible({ timeout: 30_000 })
  await setUp(page)
  await page.getByRole('button', { name: /Hämta alla/ }).click()
  await expect(page.getByText(`Hämtat 0 av ${songs.length} låtar`)).toBeVisible()
  await expect(page.getByText(`Hämtat 1 av ${songs.length} låtar`)).toBeVisible({ timeout: 600_000 })
  await page.screenshot({ path: 'test-results/drive-all.png' })
  await page.getByRole('button', { name: 'Avbryt och fortsätt senare' }).click()
  await expect(page.getByText(`Hämtat 1 av ${songs.length} låtar. Tryck på Hämta alla`)).toBeVisible()
  await expect(page.getByText(/Hämtas när du öppnar den/)).toHaveCount(songs.length - 1)

  // Going on counts over the whole list.
  await page.getByRole('button', { name: /Hämta alla/ }).click()
  await expect(page.getByText(`Hämtat 1 av ${songs.length} låtar`)).toBeVisible()
  await page.getByRole('button', { name: 'Avbryt och fortsätt senare' }).click()
})
