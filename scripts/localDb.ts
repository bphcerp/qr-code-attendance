import EmbeddedPostgres from 'embedded-postgres'
import { resolve } from 'path'

// Local Postgres for development and the verification checklist, so the app can
// be exercised without a hosted database. Not used in production -- Supabase
// provides both the database and the pooler there.
const dataDir = resolve(process.cwd(), '.pgdata')

export const LOCAL_URL = 'postgresql://postgres:postgres@localhost:55432/postgres'

export function createServer() {
  return new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'postgres',
    password: 'postgres',
    port: 55432,
    persistent: true,
  })
}

async function main() {
  const pg = createServer()
  const command = process.argv[2]

  if (command === 'init') {
    await pg.initialise()
    console.log('initialised at', dataDir)
    return
  }

  await pg.start()
  console.log('postgres listening on', LOCAL_URL)
  process.on('SIGINT', async () => {
    await pg.stop()
    process.exit(0)
  })
  // keep the process alive; stopped with ctrl-c or by killing the task
  await new Promise(() => {})
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
