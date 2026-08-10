import { eq } from 'drizzle-orm'
import { db } from '../src/db'
import { users, courses, enrollments, classSessions, attendanceRecords } from '../src/db/schema'
import { newSessionSecret, deriveQrToken, deriveCode, verifyToken, currentCounter } from '../src/lib/token'
import { isUniqueViolation } from '../src/db/errors'

let pass = 0
let fail = 0
function check(label: string, ok: boolean, detail = '') {
  if (ok) {
    pass++
    console.log(`  PASS  ${label}`)
  } else {
    fail++
    console.log(`  FAIL  ${label} ${detail}`)
  }
}

const stamp = Date.now()
const FACULTY = `prof.${stamp}@hyderabad.bits-pilani.ac.in`
const ALICE = `alice.${stamp}@hyderabad.bits-pilani.ac.in`
const BOB = `bob.${stamp}@hyderabad.bits-pilani.ac.in`
const CAROL = `carol.${stamp}@hyderabad.bits-pilani.ac.in`

async function main() {
  await db.insert(users).values([
    { email: FACULTY, name: 'Prof', role: 'faculty' },
    { email: ALICE, name: 'Alice' },
    { email: BOB, name: 'Bob' },
    { email: CAROL, name: 'Carol' },
  ])

  const [course] = await db
    .insert(courses)
    .values({ code: 'CS F211', title: 'Data Structures', facultyEmail: FACULTY })
    .returning({ id: courses.id })

  // Carol is deliberately left unenrolled
  await db.insert(enrollments).values([
    { courseId: course.id, studentEmail: ALICE },
    { courseId: course.id, studentEmail: BOB },
  ])

  const secret = newSessionSecret()
  const [session] = await db
    .insert(classSessions)
    .values({ courseId: course.id, secret })
    .returning({ id: classSessions.id, startedAt: classSessions.startedAt })

  console.log('\nEnrolment')
  const enrolledRows = await db
    .select({ email: enrollments.studentEmail })
    .from(enrollments)
    .where(eq(enrollments.courseId, course.id))
  check('enrolled students are found', enrolledRows.length === 2)
  check('unenrolled student is absent from roster', !enrolledRows.some((r) => r.email === CAROL))

  console.log('\nOne mark per student per session')
  const counter = currentCounter(session.startedAt, 5)
  const qr = deriveQrToken(secret, session.id, counter)
  check('token verifies against the stored secret', verifyToken(qr, secret, session.id, session.startedAt, 5).ok)

  await db.insert(attendanceRecords).values({
    sessionId: session.id,
    studentEmail: ALICE,
    source: 'qr',
  })

  let duplicateBlocked = false
  try {
    await db.insert(attendanceRecords).values({
      sessionId: session.id,
      studentEmail: ALICE,
      source: 'qr',
    })
  } catch (err) {
    duplicateBlocked = isUniqueViolation(err, 'attendance_one_per_student_per_session')
  }
  check('a second mark for the same student is rejected by the database', duplicateBlocked)

  const rows = await db
    .select({ id: attendanceRecords.id })
    .from(attendanceRecords)
    .where(eq(attendanceRecords.sessionId, session.id))
  check('exactly one row survives the duplicate attempt', rows.length === 1)

  console.log('\nCode path')
  const code = deriveCode(secret, session.id, counter)
  const typed = verifyToken(code.toLowerCase(), secret, session.id, session.startedAt, 5)
  check('a lowercased typed code verifies', typed.ok && typed.kind === 'code')
  const qrAsCode = verifyToken(qr, secret, session.id, session.startedAt, 5)
  check('the qr token is recognised as qr, not code', qrAsCode.ok && qrAsCode.kind === 'qr')

  console.log(`\n${pass} passed, ${fail} failed\n`)
  process.exit(fail ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
