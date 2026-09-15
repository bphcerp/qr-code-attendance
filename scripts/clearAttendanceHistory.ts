import postgres from 'postgres'

// Wipes every course's attendance history: all class sessions, and through
// ON DELETE CASCADE every attendance mark, flag, display link and review request
// hanging off them. Courses, rosters, enrolments, teaching teams, users and the
// audit log are left alone, so the next class starts on an empty report with
// nothing to set up again.
//
// There is no undo in here. On the box it runs through
// .github/workflows/clear-attendance.yml, which takes a pg_dump first and has
// the restore command. Locally:
//
//   DIRECT_URL=<target> npx tsx scripts/clearAttendanceHistory.ts           # dry run, counts only
//   DIRECT_URL=<target> npx tsx scripts/clearAttendanceHistory.ts --apply   # deletes
//
// Like importFromSupabase.ts it uses postgres directly: scripts/ cannot import
// src/ inside the container.

const TABLES = [
  'class_sessions',
  'attendance_records',
  'attendance_flags',
  'display_tokens',
  'review_requests',
] as const

const OPEN_SESSIONS = `
  select c.code, s.started_at
  from public.class_sessions s
  join public.courses c on c.id = s.course_id
  where s.ended_at is null
  order by s.started_at`

const apply = process.argv.includes('--apply')

async function count(sql: postgres.Sql | postgres.TransactionSql) {
  const out: Record<string, number> = {}
  for (const table of TABLES) {
    const [row] = await sql.unsafe(`select count(*)::int as n from public."${table}"`)
    out[table] = row.n
  }
  return out
}

function describeOpen(rows: postgres.Row[]) {
  return rows.map((row) => `${row.code} (started ${new Date(row.started_at).toISOString()})`).join(', ')
}

async function main() {
  const url = process.env.DIRECT_URL
  if (!url) throw new Error('DIRECT_URL is not set (the database to clear)')
  // Supabase is the stale pre-squash copy. Only the box was asked to be cleared.
  if (/supabase\.(com|co)/.test(url)) {
    throw new Error(`refusing to clear: DIRECT_URL points at Supabase (${new URL(url).host})`)
  }

  console.log(`target ${new URL(url).host}`)
  console.log(apply ? 'mode   APPLY\n' : 'mode   dry run (pass --apply to delete)\n')

  const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} })

  try {
    const before = await count(sql)
    const open = await sql.unsafe(OPEN_SESSIONS)

    console.log('table                  rows')
    for (const table of TABLES) console.log(`${table.padEnd(20)} ${String(before[table]).padStart(6)}`)
    if (open.length) console.log(`\nlive right now: ${describeOpen(open)}`)

    if (!apply) {
      console.log('\ndry run: nothing deleted.')
      return
    }

    const result = await sql.begin(async (tx) => {
      // EXCLUSIVE still lets the site read, but blocks a class from starting and
      // a mark's FK check until commit, so nothing lands between the open-session
      // check and the delete.
      await tx.unsafe('lock table public.class_sessions in exclusive mode')

      // Deleting a live session blanks the QR in a lecture theatre mid-scan.
      // Better to make whoever runs this end the class first.
      const stillOpen = await tx.unsafe(OPEN_SESSIONS)
      if (stillOpen.length) {
        throw new Error(`refusing to clear while a class is live: ${describeOpen(stillOpen)}. End it first.`)
      }

      const deleted = await count(tx)
      await tx.unsafe('delete from public.class_sessions')

      const actor = process.env.ACTOR ? `github:${process.env.ACTOR}` : 'clear-script'
      await tx`
        insert into audit_log (actor_email, action, subject, detail)
        values (${actor}, 'attendance.clear_all', 'all courses', ${tx.json({ deleted, run: process.env.GITHUB_RUN_ID ?? null })})
      `

      const after = await count(tx)
      const left = TABLES.filter((table) => after[table] > 0)
      if (left.length) throw new Error(`rows still there after the delete in: ${left.join(', ')} -- rolled back`)
      return { deleted, after }
    })

    console.log('\ntable                deleted   after')
    for (const table of TABLES) {
      console.log(
        `${table.padEnd(20)} ${String(result.deleted[table]).padStart(7)} ${String(result.after[table]).padStart(7)}`,
      )
    }
    console.log('\nPASS: attendance history cleared, audit_log row written')
  } finally {
    await sql.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
