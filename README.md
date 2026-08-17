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
3. `npx drizzle-kit migrate`
4. `npm run dev` -- port 3000 is usually taken by something else on this
   machine, so this lands on **3001**.

`.env.local` drives everything; `.env.example` documents each variable.
`drizzle-kit` reads `.env.local` explicitly via `drizzle.config.ts` -- it
does not pick it up on its own. Pointing the two at different databases is a
good way to lose an afternoon.

## Deploying

Production is Vercel (`master` auto-deploys) against a Supabase project.
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

## Verification

```
npx tsx --env-file=.env.local scripts/verifyDisplay.ts   # needs dev server on 3001
npx tsx --env-file=.env.local scripts/verifyMark.ts
npx tsx --env-file=.env.local scripts/verifyApp.ts       # needs dev server on 3001
```

59 checks across the three. There's no unit-test framework and none is
wanted here -- these scripts exercise the real database and real HTTP, which
is where every bug found so far actually lived.

`verifyApp.ts` mints an Auth.js session cookie itself. The cookie is just a
JWT signed with `AUTH_SECRET`, and there's no Google OAuth client set up for
local dev, so this is the only way to reach a signed-in screen at all.

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
override, CSV export, student review requests, `/device` and the rebind
approval flow, and every admin screen except `/admin/faculty` -- role
changes above faculty still go through `scripts/seedAdmin.ts`. A retention
job to purge `lat`/`lng`/`accuracy`/`ip` from `attendanceRecords` after one
semester is also missing.

Two smaller gaps: the scanner exposes a zoom slider only where
`getUserMedia` reports the capability, with no centre-crop fallback for
browsers that don't; and the nav is a plain header rather than a bottom tab
bar -- two items don't justify one yet, but it should become one once
`/device` and the review screens land.
