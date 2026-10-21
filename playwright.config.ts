import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  timeout: 1_500_000,
  use: {
    baseURL: 'http://localhost:4173/singitnow/',
    ...devices['Pixel 7'],
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  },
  webServer: { command: 'npm run preview -- --port 4173 --strictPort', url: 'http://localhost:4173/singitnow/', reuseExistingServer: true },
})
