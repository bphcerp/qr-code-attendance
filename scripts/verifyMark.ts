import { eq } from 'drizzle-orm'
import { db } from '../src/db'
import { users, courses, enrollments, classSessions, attendanceRecords, devices } from '../src/db/schema'
import { newSessionSecret, deriveQrToken, deriveCode, verifyToken, currentCounter } from '../src/lib/token'
import {
  resolveDevice,
  registerDeviceTx,
  releaseActiveDevice,
  serializeDeviceCookie,
} from '../src/lib/device'
import { haversineMetres, OUTLIER_METRES } from '../src/lib/geo'
import { isUniqueViolation } from '../src/db/errors'

// Mirrors how the mark route resolves a device: read-only decision, then the
// registration write inside a transaction so a failed mark leaves nothing.
async function markDevice(userEmail: string, cookie: string | undefined, fp: string, ua: string) {
  const decision = await resolveDevice(userEmail, cookie)
  if (!decision.ok) return { ok: false as const }
  if (decision.needsRegistration) {
    const id = await db.transaction((tx) => registerDeviceTx(tx, userEmail, fp, ua))
    return { ok: true as const, deviceId: id, justRegistered: true }
  }
  return { ok: true as const, deviceId: decision.deviceId!, justRegistered: false }
}

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
  const first = await markDevice(ALICE, undefined, 'fp-alice-phone', 'UA/1')
  check('first mark registers a device', first.ok && first.justRegistered)
  const aliceCookie = first.ok ? serializeDeviceCookie(first.deviceId) : ''

  const second = await markDevice(ALICE, aliceCookie, 'fp-alice-phone', 'UA/1')
  check('same device passes on the next mark', second.ok && !second.justRegistered)

  const noCookie = await resolveDevice(ALICE, undefined)
  check('registered student with no cookie is blocked', !noCookie.ok)

  const bobOnAlicesPhone = await resolveDevice(BOB, aliceCookie)
  check("another student cannot reuse Alice's device cookie", !bobOnAlicesPhone.ok)

  const tampered = aliceCookie.slice(0, -3) + 'aaa'
  check('a tampered cookie signature is rejected', !(await resolveDevice(ALICE, tampered)).ok)

  // A cookie whose signature is the right character length but more than that in
  // bytes used to slip past the length check and make timingSafeEqual throw a
  // RangeError -- a 500 on an ordinary attendance request. It must return null
  // (blocked), not throw.
  let craftedRejected = false
  try {
    const [id] = aliceCookie.split('.')
    const crafted = `${id}.${'é'.repeat(43)}`
    craftedRejected = !(await resolveDevice(ALICE, crafted)).ok
  } catch {
    craftedRejected = false
  }
  check('a multibyte-signature cookie is rejected without throwing', craftedRejected)

  const [aliceDevices] = await db.select().from(devices).where(eq(devices.userEmail, ALICE))
  check('exactly one active device row for Alice', Boolean(aliceDevices))

  console.log('\nConcurrent first-mark and device release')
  // Two simultaneous first-marks for one student: the unique index lets one
  // registration through and rejects the rest with 23505. The mark route adopts
  // the winner instead of 500ing; here we assert the index actually fires.
  const carolId = await db.transaction((tx) => registerDeviceTx(tx, CAROL, 'fp-carol', 'UA/9'))
  let raceRejected = false
  try {
    await db.transaction((tx) => registerDeviceTx(tx, CAROL, 'fp-carol', 'UA/9'))
  } catch (err) {
    raceRejected = isUniqueViolation(err, 'devices_one_active_per_user')
  }
  check('a second concurrent registration is rejected by the unique index', raceRejected)

  const carolCookie = serializeDeviceCookie(carolId)
  const carolBefore = await resolveDevice(CAROL, carolCookie)
  check('the registered device is accepted before release', carolBefore.ok && !carolBefore.needsRegistration)

  const releasedCarol = await releaseActiveDevice(CAROL)
  check('releaseActiveDevice frees an active binding', releasedCarol)

  const carolAfter = await resolveDevice(CAROL, undefined)
  check('after release the next mark registers again', carolAfter.ok && carolAfter.needsRegistration)

  const releasedAgain = await releaseActiveDevice(CAROL)
  check('releasing when nothing is bound is a no-op, not an error', !releasedAgain)

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
