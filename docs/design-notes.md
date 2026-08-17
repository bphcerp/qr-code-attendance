# Design notes

Why things are built the way they are, and what broke before. Read this
before changing anything security- or migration-related -- several decisions
here look arbitrary without the context.

## Three outages in three days, all the same shape

Code and schema deployed separately, every time:

| when (UTC) | broke | because |
| --- | --- | --- |
| 11-12 Aug | `/` and stats 500 | code read `course_roster` before 0002 was applied |
| 13 Aug 08:30-09:18 | roster search 500 | code read `student_directory` before 0003 was applied |
| 13 Aug 10:42-10:55 | every session start and QR issue 500 | 0005 dropped `pinned_ip`/`audit_log.ip` at 09:12 while the running build still inserted them |

The third one is the one that would've killed a live demo. That's why
`npm run vercel-build` now runs migrations before `next build` on every
production deploy instead of relying on anyone remembering to run them by
hand -- see the README's deploy section.

## The production database is not what the migration ledger says

Worth knowing before touching migrations again:

- `drizzle.__drizzle_migrations` records `0004_security_hardening` and
  `0005_privacy_and_access_controls` as applied (09:12 on 13 Aug), and their
  RLS, policies and the `attendance_app` role are in place -- but the
  columns 0005 drops (`display_tokens.pinned_ip`, `audit_log.ip`,
  `attendance_records.lat/lng/accuracy`, `devices.fingerprint`) were added
  back by hand at ~10:55 to end the outage. Neither file is on `master`
  anymore; both live on `security-hardening-wip`.
- RLS is therefore enabled on 14 tables in production, and it's live:
  `attendance_app` exists, has `LOGIN`, does not have `BYPASSRLS`, and is
  what `DATABASE_URL` connects as. The app works because 0005's policies
  grant it what it needs. `review_requests` and `device_rebind_requests`
  carry restrictive deny-all policies, which is fine only for as long as
  nothing reads them -- the review queue isn't built yet.
- That role has no DDL rights, so migrations can't run over `DATABASE_URL`.
  They need `DIRECT_URL` pointed at the `postgres` role on the session
  pooler (5432).
- The ledger also holds a row for a since-edited `0003`, so its recorded
  hash matches no file in the repo.

**The renumbering trap.** Drizzle applies a migration only when its journal
`when` is strictly greater than the newest `created_at` already recorded
(`pg-core/dialect.cjs`: `Number(lastDbMigration.created_at) < migration.folderMillis`).
Production's newest record is `1786618632451`. The parked hardening
migrations on `security-hardening-wip` carry `1786612339408` and
`1786612370526` -- both older. Rebasing that branch without regenerating
those timestamps means they'd be skipped silently forever, and the deploy
would look fine until the first query hits a column that was never added.
Renumber the files and regenerate the `when` values before merging that
branch.

## Things that are the way they are on purpose

- **The QR payload carries no counter.** Ten characters instead of thirteen;
  QR module size is what decides whether row 20 can scan, and verification
  just checks two candidate counters instead of one.
- **`/display` is reachable only with a display token**, never a faculty
  cookie. Faculty auth gates issuing the token. An unguessable URL is not
  access control: anyone holding that link can mark from anywhere.
- **Display liveness comes from `lastPingAt` in Postgres**, not from open
  connections. Serverless instances share no memory.
- **Nothing is ever blocked on a fingerprint, only flagged.** UA + screen +
  timezone identifies a phone *model*, not a phone: two classmates on the
  same Redmi produce a byte-identical hash from two handsets. A hard block
  would reject honest students, worst of all in the first lecture when
  nobody has a device row yet to tell them apart. The mark-time flag carries
  the count it saw at that moment; the cluster-size judgement still belongs
  at roster read. The dashboard label says "Same phone model as another
  student," not "same device" -- device binding has already proven they're
  on separate handsets by the time this flag can fire, so the copy
  shouldn't imply otherwise.
- **A student with no device row yet gets whatever handset is in front of
  them**, which is the one window where a colluding pair can proxy -- sign
  into the absent student's Google account and scan. It closes permanently
  once that student has marked once. It's not blockable, because an honest
  first-timer looks identical, so it raises `device_first_use` instead. The
  structural fix is `/device` with an approved binding step, which is not
  built.
- **The projector link is never printed on screen, even to the faculty who
  generated it.** Once issued it's copy/open-only. Device binding and geo
  don't help against a leaked link -- a student who has it can open the
  live QR from their own room on their own already-registered phone, geo
  just flags the distance rather than blocking it. The podium screen gets
  shared over Zoom for hybrid sections and glanced at by whoever's standing
  nearby, so the raw URL sitting in plain text was the easiest way for that
  leak to happen by accident.
- **Faculty access is granted to an address, but lands on an account.**
  Both an admin on `/admin/faculty` and a course owner adding a
  co-professor may issue that grant. Writing an unknown address as a
  privileged `users` row would leave the role waiting for whoever registers
  it first, so unknown addresses stay in `facultyInvites` and, for a
  teaching team, `courseFacultyInvites`. The sign-in callback claims them
  only after Google authenticates the address. A course owner may promote
  an existing student account immediately because that account has already
  authenticated; no privileged users row is created before sign-in.
- **`isUniqueViolation` in `src/db/errors.ts` exists because Drizzle wraps
  driver errors.** The Postgres code and constraint name are on `.cause`;
  matching the outer message silently never fires.
- **`db` connects lazily** so `next build` works without `DATABASE_URL`.
- **postgres.js runs with `prepare: false`** -- Supabase's pooler is
  PgBouncer in transaction mode and cannot hold prepared-statement state.
- **Someone else's course page answers 404, not 403.** A 403 confirms the
  course exists, which is the thing the request was fishing for. The API
  routes keep using 403 -- a caller who already passed `requireCourseAccess`
  learns nothing.
- **`/scan` resolves the session server-side, before the camera opens.**
  The QR payload is the bare token with no session id in it, so the scanner
  has to be told which session it is posting to. One live class opens
  straight into the camera; several show a picker.
