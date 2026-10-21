import { expect, test } from '@playwright/test'

test('a shared link fills in the Drive folder', async ({ page }) => {
  await page.goto('./?drive=' + encodeURIComponent('https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUv?usp=sharing'))
  await expect(page.getByText('Lägg till körens låtar')).toBeVisible()
  await expect(page).not.toHaveURL(/drive=/)
  // Without a Drive key in this build the link box is hidden, but the folder is still remembered.
  const saved = await page.evaluate(async () => {
    const req = indexedDB.open('singitnow')
    const db: IDBDatabase = await new Promise((r) => (req.onsuccess = () => r(req.result)))
    const get = db.transaction('kv').objectStore('kv').get('settings')
    const row: { value: { driveUrl: string } } = await new Promise((r) => (get.onsuccess = () => r(get.result)))
    return row.value.driveUrl
  })
  expect(saved).toBe('https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUv')
})
