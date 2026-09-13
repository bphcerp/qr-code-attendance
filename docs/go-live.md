# Go-live checklist

What broke SWE E112 was not a hard crash — the upload said "566 imported" and
enrolled nobody. Every gate here exists so a silent failure like that is caught
**before** you stand in front of the class. Run the pre-deploy suite on every
change; run the pre-class smoke test the day before each first lecture.

## Before every deploy

Local Postgres up (`npx tsx scripts/localDb.ts start`, port 55432) and migrations
applied (`npx drizzle-kit migrate`), then:

```
npm run build:fixtures                                        # regenerate test-fixtures/
npx tsx --env-file=.env.local scripts/verifyRoster.ts         # roster matching (ERP/username/campus/late sign-in)
npx tsx --env-file=.env.local scripts/verifyRosterFile.ts     # the REAL parser on real-shaped fixtures
npx tsx --env-file=.env.local scripts/verifyMark.ts           # token + replay + geo
npx tsx --env-file=.env.local scripts/verifyReport.ts         # report grid, ERP-keyed
npx tsx --env-file=.env.local scripts/verifySession.ts        # one open session per course
npx tsx --env-file=.env.local scripts/loadTest.ts 600         # 600-student enrol/sync/mark, 0 errors
```

Then the browser lifecycle (needs the dev server and Playwright installed):

```
npm install                        # once, if @playwright/test is not present
npm run dev -- -p 3001             # in another terminal
npm run test:e2e                   # drives upload -> enrol -> access -> mark -> report
```

Ship only if all are green. `verifyRosterFile` and `loadTest` are the two that
would have caught the outage — do not skip them.

## Pre-class smoke test (against production, the day before)

The verify suite runs on a clean local DB. Production is where real data and the
real network live, so rehearse there:

1. **Upload the actual roster.** Confirm the toast reports the **enrolled** count,
   and that it roughly equals the class size. **If it says "0 enrolled" or a
   number far below the class, STOP** — the ID column is wrong (see below). Do not
   walk into the theatre on a zero-match roster.
2. **Two real students.** Have two students (ideally on different degrees, so both
   email-core letters are exercised) sign in and confirm the course appears and
   opens.
3. **One real mark each.** Start a session, have them scan, confirm the live stats
   count goes up and the ended-session report shows them present.
4. **The venue network, a real phone.** `/scan` needs the camera and geolocation,
   which browsers only allow over real HTTPS. Confirm on the actual lecture-hall
   Wi-Fi, not just your desk.
5. **The projector.** Open the display link on the podium PC and confirm the QR
   renders and rotates. The link pins to the first device that opens it, so open
   it on the podium, not your laptop.

## If the enrolled count is wrong

The roster's ID column must reduce to the student's email core (see
[design-notes](design-notes.md) / `src/lib/studentId.ts`):

- ERP id `41120261453`, username `f20261453`, or full email — all work.
- Campus id-card number `2026B5PS1453H` alone does **not** — its digits carry the
  degree code. Re-export with the ERP id or an email column.
- The parser reads a column headed `Email` when present; that is the most reliable
  fix for an odd sheet.

## Deploy mechanics (see README for detail)

- Deploy fires on push to **`master`** only; `deploy-on-push` reaches it via PR.
- The container entrypoint runs `deployMigrate.ts --force`. It applies pending
  migrations (currently `0002` match_key, `0003` one-open-session) — safe only if
  production's ledger is reconciled to the baseline. Confirm before the first
  deploy after a squash (`npm run db:reconcile:prod`).
- Off Vercel, the display-token IP pin trusts `x-forwarded-for`. Confirm the DADU
  box's reverse proxy sets it to the real client, or the pin is meaningless.
