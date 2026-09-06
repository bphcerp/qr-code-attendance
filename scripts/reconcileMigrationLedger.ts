import { readMigrationFiles } from 'drizzle-orm/migrator'
import postgres from 'postgres'

// One-time reconciliation for squashing the migration history into a single
// baseline (drizzle/0000_baseline.sql).
//
// The problem this solves: `drizzle-kit migrate` (which scripts/deployMigrate.ts
// runs on every production deploy) applies a migration only when its journal
// `when` is greater than the newest `created_at` already recorded in
// drizzle.__drizzle_migrations, and records each applied file by a SHA-256 of
// its contents. The squashed baseline has a brand-new hash and a newer `when`
// than anything production has recorded, so the next deploy would try to run the
// full CREATE TABLE ... set against the already-populated production database and
// fail on the first table that already exists.
//
// This rewrites the ledger to exactly the rows the repo's journal describes --
// hash and created_at taken straight from readMigrationFiles(), so they are byte
// -for-byte what the migrator itself would have inserted -- which makes the
// migrator treat the baseline as already applied and skip it.
//
// Run it once, from the same commit that will deploy, against the production
// DIRECT_URL, BEFORE that deploy:
//
//   npm run db:reconcile:prod                 # writes
//   npm run db:reconcile:prod -- --dry-run    # prints what it would do
//
// It refuses to write without --force (npm run db:reconcile:prod passes it) and
// refuses a localhost URL, for the same reasons deployMigrate.ts does.
const MIGRATIONS_FOLDER = 'drizzle'
const MIGRATIONS_SCHEMA = 'drizzle'
const MIGRATIONS_TABLE = '__drizzle_migrations'

const dryRun = process.argv.includes('--dry-run')
const forced = process.argv.includes('--force') || process.env.FORCE_RECONCILE === '1'

async function main() {
  // The rows the repo says should exist, in journal order. hash is the SHA-256
  // of each .sql file and created_at is its journal `when` -- identical to what
  // drizzle-orm's migrator computes and inserts.
  const migrations = readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER })
  if (!migrations.length) {
    throw new Error(`no migrations found in ${MIGRATIONS_FOLDER}/ -- nothing to reconcile`)
  }

  console.log(`ledger the repo describes (${migrations.length} row(s)):`)
  for (const m of migrations) {
    console.log(`  created_at=${m.folderMillis}  hash=${m.hash}`)
  }

  if (dryRun) {
    console.log('\n--dry-run: not connecting to any database, nothing written.')
    return
  }

  const url = process.env.DIRECT_URL
  if (!url) {
    throw new Error(
      'DIRECT_URL is not set. Point it at the postgres role on the session pooler ' +
        '(port 5432) -- the runtime role cannot rewrite the drizzle schema.',
    )
  }

  if (/@(localhost|127\.0\.0\.1)[:\/]/.test(url)) {
    throw new Error('refusing to reconcile: DIRECT_URL points at a local database')
  }

  if (!forced) {
    throw new Error(
      'refusing to rewrite the migration ledger without --force. This DELETEs every ' +
        `row in ${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE} and re-inserts the baseline. ` +
        'Re-run with `npm run db:reconcile:prod` (which passes --force), and only ' +
        'against the database you intend, from the commit you are about to deploy.',
    )
  }

  console.log(`\nreconciling ${new URL(url).host}`)
  const sql = postgres(url, { max: 1, prepare: false })
  try {
    await sql`CREATE SCHEMA IF NOT EXISTS ${sql(MIGRATIONS_SCHEMA)}`
    await sql`
      CREATE TABLE IF NOT EXISTS ${sql(MIGRATIONS_SCHEMA)}.${sql(MIGRATIONS_TABLE)} (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at bigint
      )
    `

    const before = await sql`
      select hash, created_at from ${sql(MIGRATIONS_SCHEMA)}.${sql(MIGRATIONS_TABLE)}
      order by created_at
    `
    console.log(`\nledger before (${before.length} row(s)):`)
    for (const row of before) {
      console.log(`  created_at=${row.created_at}  hash=${row.hash}`)
    }

    await sql.begin(async (tx) => {
      await tx`delete from ${tx(MIGRATIONS_SCHEMA)}.${tx(MIGRATIONS_TABLE)}`
      for (const m of migrations) {
        await tx`
          insert into ${tx(MIGRATIONS_SCHEMA)}.${tx(MIGRATIONS_TABLE)} ("hash", "created_at")
          values (${m.hash}, ${m.folderMillis})
        `
      }
    })

    const after = await sql`
      select hash, created_at from ${sql(MIGRATIONS_SCHEMA)}.${sql(MIGRATIONS_TABLE)}
      order by created_at
    `
    console.log(`\nledger after (${after.length} row(s)):`)
    for (const row of after) {
      console.log(`  created_at=${row.created_at}  hash=${row.hash}`)
    }
    console.log('\nreconciled. The next deploy will see the baseline as already applied and skip it.')
  } finally {
    await sql.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
