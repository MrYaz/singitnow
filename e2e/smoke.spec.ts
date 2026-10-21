import { expect, test } from '@playwright/test'
import { existsSync } from 'node:fs'

// Uses real choir material that is not in the repo. Set MATERIAL_DIR to a folder of song folders.
const DIR = process.env.MATERIAL_DIR
test.skip(!DIR || !existsSync(DIR), 'MATERIAL_DIR not set')

test('import, learn and rehearse', async ({ page }) => {
  await page.goto('./')
  await expect(page.getByText('Lägg till körens låtar')).toBeVisible()
  await page.locator('input[webkitdirectory]').setInputFiles(DIR!)
  await expect(page.getByText(/2 låtar inlästa/)).toBeVisible({ timeout: 240_000 })
  await page.screenshot({ path: 'test-results/01-voice.png' })
  await page.getByRole('button', { name: 'Sopran', exact: true }).click()
  await page.getByRole('button', { name: /^✓?\s*Sopran 1/ }).click()
  await page.getByRole('button', { name: 'Kör igång' }).click()
  await expect(page.getByText('Dagens pass')).toBeVisible()
  await expect(page.getByText('Sopran + Sopran 1')).toBeVisible()
  await page.screenshot({ path: 'test-results/02-home.png' })

  await page.getByRole('button', { name: 'Textträning' }).first().click()
  await expect(page.getByText(/Varje del tränas i 6 steg/)).toBeVisible()
  await page.screenshot({ path: 'test-results/03-path.png', fullPage: true })
  await page.getByRole('button', { name: 'Del 1' }).click()
  await page.getByRole('button', { name: 'Starta' }).click()
  await expect(page.getByText(/Lyssna på ALLA/)).toBeVisible()
  await expect(page.getByRole('group', { name: 'Lyssna på' })).toBeVisible()
  await page.screenshot({ path: 'test-results/04-listen.png' })
  await page.getByRole('button', { name: 'Klar' }).click()
  await page.getByRole('button', { name: 'Fortsätt' }).click()
  await page.getByRole('button', { name: 'Klar' }).click()
  await page.getByRole('button', { name: 'Fortsätt' }).click()
  await expect(page.getByText(/Bra jobbat|Strålande|Bra kämpat/)).toBeVisible()
  await page.getByRole('button', { name: 'Fortsätt' }).click()

  // Level 2: choose the missing word.
  await page.getByRole('button', { name: 'Del 1' }).click()
  await page.screenshot({ path: 'test-results/04b-sheet.png' })
  await page.getByRole('button', { name: 'Starta' }).click()
  await expect(page.getByText('Vilket ord saknas?')).toBeVisible()
  await page.screenshot({ path: 'test-results/05-choose.png' })
  await page.getByRole('button', { name: 'Avsluta' }).click()
  await page.getByRole('button', { name: 'Tillbaka' }).click()

  await expect(page.getByText('This is me')).toBeVisible()
  await page.getByRole('button', { name: 'Stämrep' }).nth(1).click()
  await expect(page.getByRole('button', { name: 'S1', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'A2', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Spela' })).toBeEnabled({ timeout: 60_000 })
  await expect(page.getByRole('button', { name: 'ALLA', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Mixer' }).click()
  await page.screenshot({ path: 'test-results/06-rehearsal.png' })

  // Where a voice rests, the other voices' words show in grey italics.
  await page.getByRole('button', { name: 'Tillbaka' }).click()
  await page.getByRole('button', { name: 'Stämrep' }).first().click()
  await page.getByRole('button', { name: 'A2', exact: true }).click()
  await expect(page.getByText('I was so lonesome, I was blue').first()).toBeVisible()
  await page.screenshot({ path: 'test-results/07-rest.png', fullPage: true })
})
