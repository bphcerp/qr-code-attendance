import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

// Runs the pending migrations as part of the production build, so the schema
// and the code that depends on it are never deployed separately.
//
// They were separate until now, and it cost three outages in three days. The
// worst was 13 Aug: 0005 dropped display_tokens.pinned_ip and audit_log.ip at
// 09:12 while the running build was still inserting both columns, so every
// session-start and QR-issue request 500ed from 10:42 to 10:55 -- through a
// demo -- until the columns were added back by hand. Twice before that, code
// reached production ahead of its migration instead, and the pages that read
// course_roster and student_directory 500ed on "relation does not exist".
//
// Both directions have the same cause: `drizzle-kit migrate` reads .env.local,
// which points at the embedded local Postgres, so migrating the deployed
// database was a separate manual step against a separate env file that had to
// be remembered at the right moment. This removes the remembering.

// Previews are deliberately excluded. They share the production DATABASE_URL,
// so a preview build applying a migration writes to the real database while
// production still runs the old code -- which is exactly how 0004_faculty_invites
// landed at 10:57 on 13 Aug, from a branch that was never merged.
const isProductionDeploy = process.env.VERCEL_ENV === 'production'
// --force is the flag rather than an env prefix because `FOO=1 npm run ...`
// does not work on Windows, which is where this actually gets run by hand.
const forced = process.argv.includes('--force') || process.env.FORCE_MIGRATE === '1'

async function main() {
  if (!isProductionDeploy && !forced) {
    console.log(
      `skip migrations — VERCEL_ENV=${process.env.VERCEL_ENV ?? '(unset)'}, not a production deploy`,
    )
    return
  }

  // The session pooler, not the transaction pooler: PgBouncer in transaction
  // mode cannot hold the advisory lock the migrator takes, nor the state that
  // multi-statement DDL needs.
  const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL
  if (!url) throw new Error('DIRECT_URL (or DATABASE_URL) must be set to migrate')

  // A deploy that migrates localhost has silently done nothing to the database
  // anyone is actually using, and would report success while doing it.
  if (isProductionDeploy && /@(localhost|127\.0\.0\.1)[:\/]/.test(url)) {
    throw new Error('refusing to migrate: production deploy is pointed at a local database')
  }

  console.log(`migrating ${new URL(url).host}`)

  const sql = postgres(url, { max: 1, prepare: false })
  try {
    await migrate(drizzle(sql), { migrationsFolder: 'drizzle' })
    console.log('migrations up to date')
  } finally {
    await sql.end()
  }
}

main().catch((err) => {
  // Failing the build is the point. A deploy that ships code against a schema
  // that was never migrated is the failure this script exists to prevent, so it
  // must not be allowed to reach production looking healthy.
  console.error(err)
  process.exit(1)
})
