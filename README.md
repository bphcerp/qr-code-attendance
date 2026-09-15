# QR attendance

Rotating-QR attendance for lecture theatres of 500-600 students. Stack:
Next.js 16 (App Router), TypeScript, Drizzle + Postgres, shadcn, Auth.js v5
(Google, domain-locked to the Hyderabad campus).

**NOTE:** Before touching anything security-related, read
[docs/design-notes.md](docs/design-notes.md) first. Several things in this
codebase look arbitrary until you know why they're there.

## Setup

1. `npx tsx scripts/localDb.ts init` -- once, sets up the embedded Postgres.
2. `npx tsx scripts/localDb.ts start` -- starts it on port 55432. Leave this
   running in its own terminal.
3. `npx drizzle-kit migrate` -- applies `drizzle/0000_baseline.sql`, the single
   consolidated migration that is the whole schema.
4. `npm run dev` -- port 3000 is usually taken by something else on this
   machine, so this lands on **3001**.
5. `npm run seed:students` -- optional. Loads the mess-register student
   directory (`scripts/seed/student_directory.sql`). It only backs roster
   add-by-search, so the app runs fine without it. Seeding is not schema, so it
   is a separate step rather than part of the migration.

`.env.local` drives everything; `.env.example` documents each variable.
`drizzle-kit` reads `.env.local` explicitly via `drizzle.config.ts` -- it
does not pick it up on its own. Pointing the two at different databases is a
good way to lose an afternoon.

## Deploying

Production is moving to the department box (a self-hosted GitHub Actions runner
that builds the `Dockerfile` and runs `docker-compose.yml`); Vercel still works
and is described below too. Both target the same Supabase project.
`.env.local` points at the embedded local Postgres; `.env.supabase` points at
production, and nothing reads it automatically. That separation is
deliberate, but it's also what caused every production outage so far, so
migrations no longer depend on remembering it:

- `npm run vercel-build` runs `scripts/deployMigrate.ts` before `next build`,
  so a production deploy always carries its own migrations.
- It skips previews on purpose. Previews share the production
  `DATABASE_URL`, so a preview build applying a migration writes to the real
  database while production still runs the old code.
- `npm run db:migrate:prod` is the manual escape hatch (same script,
  `--force`).

The runtime role (`DATABASE_URL` connects as it) has no DDL rights, so
migrations cannot run over that connection -- they need `DIRECT_URL` pointed
at the `postgres` role on the session pooler (port 5432). Pointing
`DIRECT_URL` at the runtime role instead fails on
`CREATE SCHEMA IF NOT EXISTS "drizzle"` before it does anything else.

### Deploying with Docker (the DADU box)

Pushing to `master` fires `.github/workflows/deploy.yml`, which pulls on the
box then `docker compose build --no-cache dadu-attendance && docker compose up
-d`. The database is the compose `db` service on the box, no longer Supabase.

The Supabase data was carried over once with `scripts/importFromSupabase.ts`,
run on the box through the `Import from Supabase` workflow (the steps are in
its header). It is column-aware because Supabase is still on the pre-squash
schema, it backfills `course_roster.match_key` (Supabase never had it, and
without it no roster matches anyone), and it is safe to re-run -- rows already
on the box win.

Config is a `.env` next to `docker-compose.yml` -- gitignored, never baked into
the image, and it must exist before the first build (compose refuses an empty
`${PORT}`). `.env.example` documents every key. Two only matter off Vercel:
`AUTH_TRUST_HOST=true` (Auth.js rejects the host otherwise and no one can sign
in) and `PORT` (compose uses it for both the published port and `next start`).
The app also needs real HTTPS -- `/scan` uses the camera and geolocation, which
browsers block outside a secure context.

Migrations run from the container entrypoint (`deployMigrate.ts --force`, then
`next start`); `--force` is needed because `VERCEL_ENV` is never set off Vercel.
A failed migration takes the container down rather than serving against the
wrong schema, which `restart: unless-stopped` turns into a visible crash loop.

**Because of the baseline squash below, run the reconciliation once against the
production database _before_ the first container deploy** -- otherwise the
entrypoint's migrate step tries to re-create tables that already exist and the
container will crash-loop. After the ledger is reconciled, the entrypoint is a
no-op on an up-to-date schema and only applies genuinely new migrations.

### The migrations were squashed into one baseline

The `0000`–`0008` history was collapsed into a single
`drizzle/0000_baseline.sql`. This is safe for a fresh database, but production
already has the old files recorded in `drizzle.__drizzle_migrations` (and the
ledger already diverges from the repo -- see `docs/design-notes.md`). The
baseline has a new hash and a newer `when`, so left alone the next production
deploy would try to run the whole `CREATE TABLE ...` set against the live
database and fail on the first table that already exists.

`scripts/reconcileMigrationLedger.ts` fixes this by rewriting the ledger to the
single row the baseline describes, so the migrator treats it as already applied
and skips it. **Run it once, against production `DIRECT_URL`, from the commit
you are about to deploy, before that deploy:**

1. Finalize `drizzle/0000_baseline.sql` and commit.
2. `npm run db:reconcile:prod -- --dry-run` -- prints the baseline hash it would
   record (no database connection).
3. `npm run db:reconcile:prod` -- rewrites `drizzle.__drizzle_migrations` in a
   transaction (refuses without `--force`, refuses a localhost URL).
4. Confirm the ledger holds exactly one row with that hash.
5. Deploy. `deployMigrate.ts` now sees the baseline as already applied, skips
   it, and `next build` proceeds.

This is a one-time step for the squash. Ordinary future migrations
(`db:generate` -> `db:migrate:prod`) do not need it.

## Verification

```
npm run verify                                                # roster + roster-file + mark + report + session, in order
```

or individually:

```
npx tsx --env-file=.env.local scripts/verifyMark.ts
npx tsx --env-file=.env.local scripts/verifyRoster.ts
npx tsx --env-file=.env.local scripts/verifyRosterFile.ts     # the real parser on real-shaped fixtures (build:fixtures first)
npx tsx --env-file=.env.local scripts/verifyReport.ts
npx tsx --env-file=.env.local scripts/verifySession.ts        # one open session per course
npx tsx --env-file=.env.local scripts/verifyDisplay.ts        # needs dev server on 3001
npx tsx --env-file=.env.local scripts/verifyApp.ts            # needs dev server on 3001
npx tsx --env-file=.env.local scripts/verifyFacultyAccess.ts  # needs dev server on 3001
```

There's no unit-test framework and none is wanted here -- these scripts exercise
the real database and real HTTP, which is where every bug found so far actually
lived. `verifyRosterFile` runs the actual Excel/CSV parser against fixtures shaped
like a real ERP export (`npm run build:fixtures` regenerates them); it exists
because the SWE E112 outage was a roster that parsed fine on clean ids but
enrolled nobody on the real sheet.

For the 500-600 student scale, `npm run test:load` (default 600) seeds a full
theatre and drives the concurrent enrol/sync/mark bursts a class start produces,
asserting correctness and printing latency. Before a first lecture, work through
[docs/go-live.md](docs/go-live.md) against production.

There is also a Playwright deploy-readiness suite:

```
npm run test:e2e
```

It boots the real app (dev server on 3001) against the database built from the
consolidated baseline and drives both roles in a real browser -- the student
home / scan / mark flow and the faculty course / session-control / projector
flow. In the same spirit as the verify scripts, it is real DB + real HTTP +
real browser, not mocked units. It signs in the way the verify scripts do,
by minting an Auth.js session cookie, because there is no Google OAuth client
outside production. It uses the Chromium already on the machine
(`PLAYWRIGHT_CHROMIUM_PATH` overrides the path) and never downloads one.

Run the server for the last three with `npm run dev -- -p 3001`, not
`next start`. Auth.js only trusts the request host automatically in dev and on
Vercel, so a production-mode server on localhost answers every
`/api/auth/session` call with `UntrustedHost` and all three suites fail on the
first fetch.

`verifyApp.ts` mints an Auth.js session cookie itself. The cookie is just a
JWT signed with `AUTH_SECRET`, and there's no Google OAuth client set up for
local dev, so this is the only way to reach a signed-in screen at all.

## Reporting

The faculty course page carries a consolidated report: every student on the
roster as a row, every **completed** class as a column, present/absent in the
cells, with a per-student total and percentage and a per-class total along the
bottom. "Download CSV" writes the same grid to a file.

A live class is deliberately excluded -- its numbers move while it runs, and
the attendance percentage on the student home page is computed over ended
sessions only, so counting a live one here would make the two screens
disagree. The roster fallback is the same one the live-session stats use: the
uploaded roster when there is one, otherwise the enrolled accounts. A student
who marked attendance but is missing from the uploaded roster still appears,
tagged "Not on roster" -- dropping a real record because a spreadsheet was
incomplete is the one failure a report like this cannot have.

## Design system

Ported from a sibling project -- the same BITS-seal palettes in OKLCH, the
same `data-theme` attribute mechanism, Montserrat / Manrope / IBM Plex Mono.

`globals.css` is unlayered, while everything from `@import 'tailwindcss'`
sits in `@layer`s. Unlayered CSS wins over every layered rule regardless of
specificity, so `text-[32px]` on an `<h1>` loses silently to the 56px rule in
that file. Use the `.page-title` / `.meta` classes declared there instead of
utility overrides at the call site.

Two rules shadcn will fight, so override deliberately:

- Nothing is a pill. Status chips are solid-fill at `border-radius: 7px`.
  shadcn's `Badge` defaults to `rounded-full`.
- The QR is never themed. `/display` sets `data-display`, forcing pure black
  on white -- contrast is what buys scanning distance from the back of a
  lecture theatre.

## Not built yet

Roster add-by-search was removed; Excel and CSV upload are the only ways to
add students. Still missing: faculty review dashboard, review queue, manual
override, student review requests, and every admin screen except
`/admin/faculty` -- role changes above faculty still go through
`scripts/seedAdmin.ts`. A retention job to purge `lat`/`lng`/`accuracy`/`ip`
from `attendanceRecords` after one semester is also missing.

Two smaller gaps: the scanner exposes a zoom slider only where
`getUserMedia` reports the capability, with no centre-crop fallback for
browsers that don't; and the nav is a plain header rather than a bottom tab
bar -- two items don't justify one yet, but it should become one once
the review screens land.
