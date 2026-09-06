import { readFileSync } from 'fs'
import { resolve } from 'path'
import postgres from 'postgres'

// Loads the student directory (the March 2026 mess register) into
// student_directory. This used to live inside migration 0003, which made every
// `drizzle-kit migrate` replay 4122 INSERTs and buried the schema history under
// a data dump. Seeding is not schema, so it lives here instead and is run
// separately -- the directory only backs roster add-by-search, so a fresh
// checkout does not need it to run the app.
//
//   npm run seed:students
//
// Idempotent: the seed file's INSERTs are ON CONFLICT, so re-running only fills
// in rows that are missing.
const SEED_FILE = resolve(process.cwd(), 'scripts/seed/student_directory.sql')

async function main() {
  // DIRECT_URL first, same reasoning as scripts/deployMigrate.ts: it is the
  // privileged, non-pooled connection. Falls back to DATABASE_URL for local
  // development, where they point at the same embedded Postgres.
  const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL
  if (!url) {
    throw new Error('neither DIRECT_URL nor DATABASE_URL is set')
  }

  const seed = readFileSync(SEED_FILE, 'utf8')

  console.log(`seeding student_directory from ${SEED_FILE}`)
  const sql = postgres(url, { max: 1, prepare: false })
  try {
    // The file is several statements (batched INSERTs plus a row-count notice).
    // unsafe() runs them over the simple-query protocol, which allows multiple
    // statements in one round trip -- prepared statements would not.
    await sql.unsafe(seed)
    const [{ count }] = await sql`select count(*)::int as count from public.student_directory`
    console.log(`student_directory: ${count} rows`)
  } finally {
    await sql.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
