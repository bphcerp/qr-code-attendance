import { count, eq, inArray } from 'drizzle-orm'
import { db } from '../src/db'
import { attendanceRecords, classSessions, courses, enrollments, users } from '../src/db/schema'
import { replaceCourseRoster } from '../src/lib/courseRoster'
import { syncRosterEnrollment } from '../src/lib/syncRosterEnrollment'
import { newSessionSecret } from '../src/lib/token'

// The 600-student dimension the verify scripts never touch. Seeds a full lecture
// theatre and drives the three concurrent write bursts a class start actually
// produces -- roster upload, the layout-sync enrolment every student triggers on
// first navigation, and 600 attendance marks landing at once -- against the real
// database with prepare:false (the Supabase pooler runs PgBouncer in transaction
// mode). It asserts correctness under concurrency and prints latency so a
// regression in the enrolment/mark path shows up as numbers, not as a live class.
//
//   npx tsx --env-file=.env.local scripts/loadTest.ts [count]
const N = Math.max(1, Number(process.argv[2]) || 600)

function stats(label: string, ms: number[]) {
  const sorted = [...ms].sort((a, b) => a - b)
  const at = (p: number) => Math.round(sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))])
  console.log(`  ${label}: n=${ms.length} p50=${at(50)}ms p95=${at(95)}ms max=${Math.round(sorted[sorted.length - 1])}ms`)
}

async function timed<T>(fn: () => Promise<T>): Promise<{ ok: boolean; ms: number; error?: string }> {
  const t = Date.now()
  try {
    await fn()
    return { ok: true, ms: Date.now() - t }
  } catch (err) {
    return { ok: false, ms: Date.now() - t, error: err instanceof Error ? err.message : String(err) }
  }
}

async function main() {
  const stamp = Date.now()
  // A run tag in letters keeps the prof's email-core non-numeric so it can never
  // collide with a student's eight-digit core (which would enrol the professor).
  const prof = `load.prof.${stamp.toString(36).replace(/[0-9]/g, '')}@hyderabad.bits-pilani.ac.in`
  // Each core is exactly eight digits -- a 4-digit run tag + a 4-digit serial --
  // so it is unique per student, roughly unique per run, and (crucially) the
  // ONLY digits in the email local part, so emailCore reduces to it cleanly.
  const runTag = String(1000 + (stamp % 9000))
  const students = Array.from({ length: N }, (_, i) => {
    const core = `${runTag}${String(i + 1).padStart(4, '0')}`
    return { core, erp: `411${core}`, email: `f${core}@hyderabad.bits-pilani.ac.in`, name: `LOAD STUDENT ${i + 1}` }
  })

  console.log(`load test: ${N} students`)
  await db.insert(users).values({ email: prof, name: 'Load Prof', role: 'faculty' }).onConflictDoNothing()
  const [course] = await db
    .insert(courses)
    .values({ code: `LOAD ${stamp}`, title: 'Load Test', facultyEmail: prof })
    .returning({ id: courses.id })

  // Roster carries the ERP id only; enrolment keys on its eight-digit core,
  // which is exactly the student's email core -- the real SWE E112 shape.
  const rosterRows = students.map((s) => ({ studentId: s.erp, studentName: s.name }))

  try {
    // Seed the 600 accounts (as if they had all signed in at least once).
    await db.insert(users).values(students.map((s) => ({ email: s.email, name: s.name }))).onConflictDoNothing()

    // 1. Roster upload: one call, one big insert + one account-match query.
    const upload = await timed(() => replaceCourseRoster(course.id, rosterRows))
    const [enrolledAfterUpload] = await db
      .select({ count: count() })
      .from(enrollments)
      .where(eq(enrollments.courseId, course.id))
    console.log(`\nroster upload of ${N}: ${upload.ms}ms, enrolled ${enrolledAfterUpload.count}/${N}${upload.ok ? '' : ' ERROR: ' + upload.error}`)

    // 2. Layout-sync burst: clear enrolments, then every student hits the sync
    //    concurrently the way 600 phones opening the app at once would.
    await db.delete(enrollments).where(eq(enrollments.courseId, course.id))
    const syncResults = await Promise.all(students.map((s) => timed(() => syncRosterEnrollment(s.email))))
    const syncFail = syncResults.filter((r) => !r.ok)
    const [enrolledAfterSync] = await db
      .select({ count: count() })
      .from(enrollments)
      .where(eq(enrollments.courseId, course.id))
    console.log(`\nconcurrent layout-sync x${N}: ${syncFail.length} errors, enrolled ${enrolledAfterSync.count}/${N}`)
    stats('sync', syncResults.map((r) => r.ms))
    if (syncFail.length) console.log('  first error:', syncFail[0].error)

    // 3. Mark burst: 600 attendance rows landing at once on one live session.
    const [session] = await db
      .insert(classSessions)
      .values({ courseId: course.id, secret: newSessionSecret() })
      .returning({ id: classSessions.id })
    const markResults = await Promise.all(
      students.map((s) =>
        timed(() =>
          db.insert(attendanceRecords).values({ sessionId: session.id, studentEmail: s.email, source: 'qr' }),
        ),
      ),
    )
    const markFail = markResults.filter((r) => !r.ok)
    const [marked] = await db
      .select({ count: count() })
      .from(attendanceRecords)
      .where(eq(attendanceRecords.sessionId, session.id))
    console.log(`\nconcurrent marks x${N}: ${markFail.length} errors, recorded ${marked.count}/${N}`)
    stats('mark', markResults.map((r) => r.ms))
    if (markFail.length) console.log('  first error:', markFail[0].error)

    const ok = enrolledAfterUpload.count === N && enrolledAfterSync.count === N && marked.count === N && !syncFail.length && !markFail.length
    console.log(`\n${ok ? 'LOAD TEST PASS' : 'LOAD TEST FAIL'} — enrol/sync/mark all correct under ${N}-way concurrency`)
    if (!ok) process.exitCode = 1
  } finally {
    await db.delete(courses).where(eq(courses.id, course.id))
    await db.delete(users).where(eq(users.email, prof))
    // Delete the seeded students in chunks to stay well under any parameter cap.
    const emails = students.map((s) => s.email)
    for (let i = 0; i < emails.length; i += 200) {
      await db.delete(users).where(inArray(users.email, emails.slice(i, i + 200)))
    }
  }
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
