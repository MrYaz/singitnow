import { expect, test } from '@playwright/test'
import { existsSync } from 'node:fs'

// Uses real choir material that is not in the repo. Set MATERIAL_DIR to a folder of song folders.
const DIR = process.env.MATERIAL_DIR
test.skip(!DIR || !existsSync(DIR), 'MATERIAL_DIR not set')

test('import, learn and rehearse', async ({ page }) => {
  await page.goto('./')
  await expect(page.getByText('Lägg till körens låtar')).toBeVisible()
  await page.locator('input[webkitdirectory]').setInputFiles(DIR!)
  await expect(page.getByText(/2 låtar inlästa/)).toBeVisible({ timeout: 1_200_000 })
  await page.screenshot({ path: 'test-results/01-voice.png', fullPage: true })
  await page.getByRole('button', { name: 'Sopran', exact: true }).click()
  await page.getByRole('button', { name: /^✓?\s*Sopran 1/ }).click()
  await page.getByPlaceholder('Ditt förnamn').fill('Ella')
  await page.getByRole('button', { name: 'Kör igång' }).click()
  await expect(page.getByText('Dagens pass')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Mina stämmor: Sopran + Sopran 1' })).toHaveText('S + S1 ▾')
  await expect(page.getByText('Hej Ella! 👋')).toBeVisible()
  await page.screenshot({ path: 'test-results/02-home.png' })
  // The three song buttons fit on a narrow phone.
  await page.setViewportSize({ width: 340, height: 740 })
  const box = await page.getByRole('button', { name: 'Körrep' }).first().boundingBox()
  expect(box!.x + box!.width).toBeLessThanOrEqual(340 - 16)
  await page.screenshot({ path: 'test-results/02b-home-narrow.png' })
  await page.setViewportSize({ width: 412, height: 839 })

  await page.getByRole('button', { name: 'Textträning' }).first().click()
  await expect(page.getByRole('radiogroup', { name: 'Inlärningssätt' })).toBeVisible()
  await page.screenshot({ path: 'test-results/03-path.png', fullPage: true })
  await page.getByRole('button', { name: 'Del 1', exact: true }).click()
  // Your own voice is the default; switching keeps going with the new voice.
  await expect(page.getByText(/Lyssna på Sopran/)).toBeVisible()
  await expect(page.getByRole('group', { name: 'Lyssna på' })).toBeVisible()
  await page.getByRole('group', { name: 'Lyssna på' }).getByRole('button', { name: 'ALLA' }).click()
  await expect(page.getByText(/Lyssna på ALLA/)).toBeVisible()
  await page.screenshot({ path: 'test-results/04-listen.png' })
  await page.getByRole('button', { name: 'Klar' }).click()
  await page.getByRole('button', { name: 'Fortsätt' }).click()
  await page.getByRole('button', { name: 'Klar' }).click()
  await page.getByRole('button', { name: 'Fortsätt' }).click()
  await expect(page.getByText(/Del 1 av \d+ är klar med lyssna/)).toBeVisible()
  await page.screenshot({ path: 'test-results/04b-done.png' })
  // Straight on to the next part, same method.
  await page.getByRole('button', { name: 'Nästa del →' }).click()
  await expect(page.getByText(/LYSSNA · DEL 2/i)).toBeVisible()
  await page.getByRole('button', { name: 'Avsluta' }).click()
  await expect(page.getByRole('radio', { name: /Lyssna\s*1\/\d+ delar/ })).toBeVisible()

  // Pick another method, then a part.
  await page.getByRole('radio', { name: /Saknar ord/ }).click()
  await page.getByRole('button', { name: 'Del 1', exact: true }).click()
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

  // Körrep: just the lyrics, with adjustable size, and on to the next song.
  await page.getByRole('button', { name: 'Tillbaka' }).click()
  await page.getByRole('button', { name: 'Körrep' }).first().click()
  await expect(page.getByRole('heading', { name: 'Why did it have to be me' })).toBeVisible()
  await page.getByRole('button', { name: 'Större text' }).click()
  await page.getByRole('button', { name: 'Alt 2', exact: true }).click()
  await expect(page.getByText(/tyst \(Sopraner\)/).first()).toBeVisible()
  await page.screenshot({ path: 'test-results/08-read.png' })
  // Small sizes, so lines fit a phone without wrapping.
  const smaller = page.getByRole('button', { name: 'Mindre text' })
  while (await smaller.isEnabled()) await smaller.click()
  await expect(page.getByRole('button', { name: 'Mindre text' })).toBeDisabled()
  await page.screenshot({ path: 'test-results/08a-read-small.png' })
  await page.setViewportSize({ width: 820, height: 1180 })
  await page.screenshot({ path: 'test-results/08b-read-tablet.png' })
  await page.getByRole('button', { name: /This is me ›/ }).click()
  await expect(page.getByRole('heading', { name: 'This is me' })).toBeVisible()

  // The phone's back button steps back in the app, not out of it.
  await page.goBack()
  await expect(page.getByText('Dagens pass')).toBeVisible()
  await page.getByRole('button', { name: 'Textträning' }).first().click()
  await expect(page.getByRole('radiogroup', { name: 'Inlärningssätt' })).toBeVisible()
  await page.goBack()
  await expect(page.getByText('Dagens pass')).toBeVisible()
  expect(page.url()).toContain('/singitnow/')
})
