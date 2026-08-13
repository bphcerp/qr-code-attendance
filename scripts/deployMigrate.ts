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

  // DIRECT_URL only, and deliberately no fall back to DATABASE_URL. Two
  // separate reasons, both of which bite:
  //
  // - DATABASE_URL is the transaction pooler. PgBouncer in transaction mode
  //   cannot hold the advisory lock the migrator takes, nor the state that
  //   multi-statement DDL needs.
  // - DATABASE_URL is also the *runtime* role. Production connects as
  //   attendance_app, which has table privileges and no DDL rights at all --
  //   it cannot even `CREATE SCHEMA IF NOT EXISTS "drizzle"`, which the
  //   migrator issues before anything else (Postgres checks the privilege
  //   before the IF NOT EXISTS shortcut, so an existing schema still fails).
  //   Granting it DDL to make this work would defeat the point of running the
  //   app under a restricted role.
  //
  // So migrating needs its own privileged connection. Without one, say so and
  // let the deploy through rather than blocking every deploy on it.
  const url = process.env.DIRECT_URL
  if (!url) {
    console.warn(
      'WARNING: DIRECT_URL is not set, so no migrations were applied.\n' +
        '  Migrations must then be run by hand (npm run db:migrate:prod) and it is\n' +
        '  possible to deploy code against a schema that was never migrated -- the\n' +
        '  exact failure this script exists to prevent.\n' +
        '  Set DIRECT_URL to the session-pooler URL of a role that can run DDL\n' +
        '  (port 5432, the postgres role -- not the attendance_app runtime role).',
    )
    return
  }

  // A deploy that migrates localhost has silently done nothing to the database
  // anyone is actually using, and would report success while doing it.
  if (isProductionDeploy && /@(localhost|127\.0\.0\.1)[:\/]/.test(url)) {
    throw new Error('refusing to migrate: production deploy is pointed at a local database')
  }

  console.log(`migrating ${new URL(url).host}`)

  const sql = postgres(url, { max: 1, prepare: false })
  try {
    // Checked up front rather than discovered halfway through. The migrator's
    // very first statement is CREATE SCHEMA IF NOT EXISTS "drizzle", so a
    // connection without DDL rights dies there -- and a deploy that fails on
    // *configuration* would block every deploy, including the ones that fix it.
    // A genuine migration failure below still fails the build, which is the
    // part that matters.
    const [{ can_create: canCreate, who }] = await sql`
      select
        has_database_privilege(current_user, current_database(), 'CREATE') as can_create,
        current_user as who
    `
    if (!canCreate) {
      console.warn(
        `WARNING: connected as "${who}", which cannot run DDL — no migrations were applied.\n` +
          '  This is the runtime role. Point DIRECT_URL at the postgres role on the\n' +
          '  session pooler (5432) instead, or run npm run db:migrate:prod by hand.',
      )
      return
    }

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
