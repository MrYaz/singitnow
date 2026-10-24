import { expect, test } from '@playwright/test'
test('stuck database says what to do', async ({ page, context }) => {
  await page.goto('./registerSW.js')
  // Another tab holds an old version of the database and never lets go.
  await page.evaluate(() => new Promise((res) => {
    const q = indexedDB.open('singitnow', 10)
    q.onupgradeneeded = () => q.result.createObjectStore('kv', { keyPath: 'key' })
    q.onsuccess = () => res(null)
  }))
  const app = await context.newPage()
  await app.goto('./')
  await expect(app.getByText('Appen kommer inte åt sitt minne just nu')).toBeVisible({ timeout: 15_000 })
  await app.screenshot({ path: 'test-results/stuck.png' })
})
