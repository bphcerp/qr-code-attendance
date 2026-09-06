// Worker processes evaluate this module before touching the database or minting
// cookies, so the same .env.local the Playwright config loads is present here
// too (workers don't inherit the config process's runtime env mutations).
try {
  process.loadEnvFile('.env.local')
} catch {
  // env supplied directly -- fall through to process.env
}

export {}
