import postgres from 'postgres'

// One-time copy of the Supabase data into the DADU box's own Postgres, now that
// production runs against the compose `db` service instead of Supabase.
//
// Not a pg_dump/restore, for two reasons that both bite:
//
// - Supabase is still on the pre-squash schema. It carries columns the baseline
//   no longer has (attendance_records.device_id / fingerprint / fingerprint_hash,
//   audit_log.network_hash, display_tokens.pinned_network_hash) and tables that
//   were dropped (devices, device_rebind_requests), so a column-listed dump fails
//   on the first INSERT. Rows here go through json_populate_recordset, which
//   takes the columns the target has and ignores the rest.
// - Supabase has no course_roster.match_key. Imported as-is every roster row has
//   a null key, syncRosterEnrollment never matches anyone, and the SWE E112
//   roster enrols nobody again -- the exact outage 0002 was written to fix. So
//   the key is backfilled here with the same reduction as emailCore().
//
// Supabase is only ever read, inside one read-only snapshot. Every write to the
// target is in a single transaction, so a failure leaves the box untouched.
// Existing target rows win on conflict (ON CONFLICT DO NOTHING), which makes it
// safe to re-run -- except a users row that is still the default 'student'
// takes the Supabase role, so a faculty member who already signed in on the new
// box gets their courses back.
//
//   SOURCE_DATABASE_URL=<supabase session pooler, :5432> DIRECT_URL=<target> \
//     npx tsx scripts/importFromSupabase.ts            # dry run, counts only
//   ... npx tsx scripts/importFromSupabase.ts --apply  # writes
//
// On the box it runs inside the app container, where DIRECT_URL is already db:5432.

// FK order. devices / device_rebind_requests are gone from the schema,
// private.rate_limit_buckets is throwaway state, and the drizzle ledger belongs
// to the target.
const TABLES = [
  'users',
  'student_directory',
  'courses',
  'course_faculty',
  'enrollments',
  'course_roster',
  'class_sessions',
  'display_tokens',
  'attendance_records',
  'attendance_flags',
  'review_requests',
  'audit_log',
] as const

const CHUNK = 500
const apply = process.argv.includes('--apply')

// emailCore() from src/lib/studentId.ts, in SQL: the last eight digits when there
// are at least eight, otherwise the trimmed, lowercased, whitespace-free id.
// scripts/ cannot import src/ inside the container (the image only ships scripts/).
const ROSTER_KEY = `case
  when length(regexp_replace(student_id, '[^0-9]', '', 'g')) >= 8
    then right(regexp_replace(student_id, '[^0-9]', '', 'g'), 8)
  else lower(regexp_replace(btrim(student_id), '\\s+', '', 'g'))
end`

// Same as accountKey in src/lib/courseRoster.ts.
const ACCOUNT_KEY = `right(regexp_replace(split_part(lower(u.email), '@', 1), '[^0-9]', '', 'g'), 8)`

function hostOf(url: string) {
  return new URL(url).host
}

async function main() {
  const sourceUrl = process.env.SOURCE_DATABASE_URL
  const targetUrl = process.env.DIRECT_URL
  if (!sourceUrl) throw new Error('SOURCE_DATABASE_URL is not set (the Supabase session pooler URL, port 5432)')
  if (!targetUrl) throw new Error('DIRECT_URL is not set (the database to import into)')

  // The one mistake that would actually hurt: importing in the wrong direction.
  if (sourceUrl === targetUrl) throw new Error('SOURCE_DATABASE_URL and DIRECT_URL are the same database')
  if (/supabase\.(com|co)/.test(targetUrl)) {
    throw new Error(`refusing to import: DIRECT_URL points at Supabase (${hostOf(targetUrl)}), which is the source`)
  }

  console.log(`source ${hostOf(sourceUrl)}`)
  console.log(`target ${hostOf(targetUrl)}`)
  console.log(apply ? 'mode   APPLY\n' : 'mode   dry run (pass --apply to write)\n')

  const source = postgres(sourceUrl, { max: 1, prepare: false, onnotice: () => {} })
  const target = postgres(targetUrl, { max: 1, prepare: false, onnotice: () => {} })

  try {
    // One consistent snapshot of every table, so a class marked mid-copy cannot
    // leave a record pointing at a session that was read before it existed.
    const data = await source.begin('isolation level repeatable read read only', async (tx) => {
      const out: Record<string, unknown[]> = {}
      for (const table of TABLES) {
        const [row] = await tx.unsafe(`select coalesce(json_agg(t), '[]'::json) as rows from public."${table}" t`)
        out[table] = row.rows as unknown[]
      }
      return out
    })

    const hasMatchKey =
      (
        await target`
          select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'course_roster' and column_name = 'match_key'
        `
      ).length > 0

    const countTarget = async (sql: postgres.Sql | postgres.TransactionSql) => {
      const out: Record<string, number> = {}
      for (const table of TABLES) {
        const [row] = await sql.unsafe(`select count(*)::int as n from public."${table}"`)
        out[table] = row.n
      }
      return out
    }

    const before = await countTarget(target)

    if (!apply) {
      console.log('table                 supabase   target now')
      for (const table of TABLES) {
        console.log(`${table.padEnd(20)} ${String(data[table].length).padStart(9)} ${String(before[table]).padStart(12)}`)
      }
      if (!hasMatchKey) {
        console.log('\nWARNING: target has no course_roster.match_key -- 0002 is not applied yet.')
        console.log('  Deploy first so the entrypoint migrates, or rosters will import without keys.')
      }
      console.log('\ndry run: nothing written.')
      return
    }

    const result = await target.begin(async (tx) => {
      const inserted: Record<string, number> = {}

      for (const table of TABLES) {
        const rows = data[table]
        inserted[table] = 0
        for (let i = 0; i < rows.length; i += CHUNK) {
          const chunk = JSON.stringify(rows.slice(i, i + CHUNK))
          const conflict =
            table === 'users'
              ? `on conflict (email) do update set role = excluded.role
                   where users.role = 'student' and excluded.role <> 'student'`
              : 'on conflict do nothing'
          // $1::text, not $1::json -- postgres-js sees a json-typed parameter and
          // JSON-encodes the already-stringified chunk a second time, which lands
          // as one scalar string ("cannot call json_populate_recordset on a scalar").
          const res = await tx.unsafe(
            `insert into public."${table}"
             select * from json_populate_recordset(null::public."${table}", $1::text::json)
             ${conflict}`,
            [chunk],
          )
          inserted[table] += res.count
        }
      }

      let keyed = 0
      let enrolled = 0
      if (hasMatchKey) {
        keyed = (await tx.unsafe(`update public.course_roster set match_key = ${ROSTER_KEY} where match_key is null`))
          .count

        // What replaceCourseRoster() would have done at upload had the email-core
        // match existed then -- the sign-in sync does the same thing lazily, but
        // doing it now means the faculty screens show enrolled students before
        // anyone has signed in on the new box.
        enrolled = (
          await tx.unsafe(`
            insert into public.enrollments (course_id, student_email)
            select distinct r.course_id, u.email
            from public.course_roster r
            join public.users u on ${ACCOUNT_KEY} = r.match_key
            on conflict do nothing
          `)
        ).count
      }

      await tx`
        insert into audit_log (actor_email, action, subject, detail)
        values ('import-script', 'data.import', ${hostOf(sourceUrl)}, ${tx.json({ inserted, keyed, enrolled })})
      `

      return { inserted, keyed, enrolled, after: await countTarget(tx) }
    })

    console.log('table                 supabase   before   inserted   after')
    for (const table of TABLES) {
      console.log(
        `${table.padEnd(20)} ${String(data[table].length).padStart(9)} ${String(before[table]).padStart(8)} ` +
          `${String(result.inserted[table]).padStart(10)} ${String(result.after[table]).padStart(7)}`,
      )
    }
    if (hasMatchKey) {
      console.log(`\nroster rows keyed: ${result.keyed}`)
      console.log(`enrolments added from rosters: ${result.enrolled}`)
    } else {
      console.log('\nWARNING: no course_roster.match_key on the target -- rosters imported without keys.')
    }

    // Everything in Supabase should now be on the target. A shortfall means rows
    // were dropped on a conflict with something already there, which is worth
    // a look rather than a silent success.
    const short = TABLES.filter((t) => result.after[t] < data[t].length)
    if (short.length) {
      console.log(`\nFAIL: target has fewer rows than Supabase in: ${short.join(', ')}`)
      process.exitCode = 1
    } else {
      console.log('\nPASS: every Supabase row is on the target')
    }
  } finally {
    await source.end()
    await target.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
