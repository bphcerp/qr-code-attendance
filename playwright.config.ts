import { defineConfig, devices } from '@playwright/test'

// drizzle-kit and Next read .env.local; Playwright does not on its own. Load it
// here so AUTH_SECRET / DATABASE_URL are present for the config, the webServer,
// and (via e2e/helpers/env.ts) the worker processes that mint cookies and seed.
try {
  process.loadEnvFile('.env.local')
} catch {
  // no .env.local (CI, or env supplied directly) -- fall through to process.env
}

// The app refuses to run signed-in screens under `next start` on localhost
// (Auth.js answers UntrustedHost), so the E2E drives `next dev` on 3001 -- the
// same port and mode the verify:* scripts and the README assume.
const PORT = 3001
const BASE_URL = `http://localhost:${PORT}`

// Chromium is pre-installed in this environment; the bundled revision Playwright
// would otherwise download is absent, so point it at the installed binary. The
// stable symlink resolves to whatever revision is present.
const chromiumPath = process.env.PLAYWRIGHT_CHROMIUM_PATH ?? '/opt/pw-browsers/chromium'

export default defineConfig({
  testDir: './e2e',
  // Specs share one database and one dev server, so run them serially.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list']],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    launchOptions: { executablePath: chromiumPath },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npm run dev -- -p ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
})
