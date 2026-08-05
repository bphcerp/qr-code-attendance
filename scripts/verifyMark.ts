import { eq } from 'drizzle-orm'
import { db } from '../src/db'
import { users, courses, enrollments, classSessions, attendanceRecords, devices } from '../src/db/schema'
import { newSessionSecret, deriveQrToken, deriveCode, verifyToken, currentCounter } from '../src/lib/token'
import { checkDevice, serializeDeviceCookie } from '../src/lib/device'
import { haversineMetres, OUTLIER_METRES } from '../src/lib/geo'
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
    .values({ courseId: course.id, secret, roomLat: 17.5449, roomLng: 78.5718 })
    .returning({ id: classSessions.id, startedAt: classSessions.startedAt })

  console.log('\nEnrolment')
  const enrolledRows = await db
    .select({ email: enrollments.studentEmail })
    .from(enrollments)
    .where(eq(enrollments.courseId, course.id))
  check('enrolled students are found', enrolledRows.length === 2)
  check('unenrolled student is absent from roster', !enrolledRows.some((r) => r.email === CAROL))

  console.log('\nDevice binding')
  const first = await checkDevice(ALICE, undefined, 'fp-alice-phone', 'UA/1')
  check('first mark registers a device', first.ok && first.justRegistered)
  const aliceCookie = first.ok ? serializeDeviceCookie(first.deviceId) : ''

  const second = await checkDevice(ALICE, aliceCookie, 'fp-alice-phone', 'UA/1')
  check('same device passes on the next mark', second.ok && !second.justRegistered)

  const noCookie = await checkDevice(ALICE, undefined, 'fp-alice-phone', 'UA/1')
  check('registered student with no cookie is blocked', !noCookie.ok)

  const bobOnAlicesPhone = await checkDevice(BOB, aliceCookie, 'fp-alice-phone', 'UA/1')
  check("another student cannot reuse Alice's device cookie", !bobOnAlicesPhone.ok)

  const tampered = aliceCookie.slice(0, -3) + 'aaa'
  check('a tampered cookie signature is rejected', !(await checkDevice(ALICE, tampered, 'fp', 'UA/1')).ok)

  const [aliceDevices] = await db.select().from(devices).where(eq(devices.userEmail, ALICE))
  check('exactly one active device row for Alice', Boolean(aliceDevices))

  console.log('\nOne mark per student per session')
  const counter = currentCounter(session.startedAt, 5)
  const qr = deriveQrToken(secret, session.id, counter)
  check('token verifies against the stored secret', verifyToken(qr, secret, session.id, session.startedAt, 5).ok)

  await db.insert(attendanceRecords).values({
    sessionId: session.id,
    studentEmail: ALICE,
    source: 'qr',
    fingerprint: 'fp-alice-phone',
  })

  let duplicateBlocked = false
  try {
    await db.insert(attendanceRecords).values({
      sessionId: session.id,
      studentEmail: ALICE,
      source: 'qr',
      fingerprint: 'fp-alice-phone',
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

  console.log('\nGeolocation flagging')
  const inRoom = haversineMetres(17.5449, 78.5718, 17.5449, 78.5718)
  const backRow = haversineMetres(17.5449, 78.5718, 17.5452, 78.5721)
  const hostel = haversineMetres(17.5449, 78.5718, 17.5350, 78.5800)
  check('a student in the room is not an outlier', inRoom < OUTLIER_METRES, `${Math.round(inRoom)}m`)
  check('the back row is not an outlier', backRow < OUTLIER_METRES, `${Math.round(backRow)}m`)
  check('the hostel is an outlier', hostel > OUTLIER_METRES, `${Math.round(hostel)}m`)

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
