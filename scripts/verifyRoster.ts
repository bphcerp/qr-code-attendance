import { and, count, eq } from 'drizzle-orm'
import * as XLSX from 'xlsx'
import { db } from '../src/db'
import { courseRoster, courses, enrollments, users } from '../src/db/schema'
import { removeRosterStudent, replaceCourseRoster } from '../src/lib/courseRoster'
import { parseRosterFile } from '../src/lib/parseRosterFile'
import { syncRosterEnrollment } from '../src/lib/syncRosterEnrollment'

const STUDENT_EMAIL = 'f20250558@hyderabad.bits-pilani.ac.in'
const STUDENT_ID = 'f20250558'
const STUDENT_ERP = '41120250558' // 411 + the eight-digit email core, the real ERP export id
const STUDENT_CAMPUS = '2025A7PS0558H' // ID-card number: digits do NOT reduce to the core
const STUDENT_NAME = 'SUNJAY VARRUN M S'

// A second student who has no account until the test makes one -- so the
// late-sign-in path can be checked, not just the enrol-at-upload path.
const LATE_EMAIL = 'f20259997@hyderabad.bits-pilani.ac.in'
const LATE_ERP = '41120259997'
let passed = 0

function check(label: string, condition: boolean) {
  if (!condition) throw new Error(`FAIL: ${label}`)
  passed++
  console.log(`PASS: ${label}`)
}

// A stand-in for the browser File the upload hands parseRosterFile -- it only
// touches .name/.text()/.arrayBuffer(). Lets the test drive the real parser.
function sheetFile(name: string, aoa: string[][]): File {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'ps')
  const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
  return {
    name,
    async text() {
      return Buffer.from(buffer).toString()
    },
    async arrayBuffer() {
      return buffer
    },
  } as unknown as File
}

async function main() {
  const stamp = Date.now()
  const professor = `roster.prof.${stamp}@hyderabad.bits-pilani.ac.in`
  const [existingAccount] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.email, STUDENT_EMAIL))

  await db.insert(users).values([
    { email: professor, name: 'Roster Test Professor', role: 'faculty' },
    { email: STUDENT_EMAIL, name: STUDENT_NAME },
  ]).onConflictDoNothing()

  const [course] = await db
    .insert(courses)
    .values({ code: `ROSTER ${stamp}`, title: 'Roster Test', facultyEmail: professor })
    .returning({ id: courses.id })

  async function enrollmentCount() {
    const [row] = await db
      .select({ count: count() })
      .from(enrollments)
      .where(and(eq(enrollments.courseId, course.id), eq(enrollments.studentEmail, STUDENT_EMAIL)))
    return row.count
  }

  try {
    await replaceCourseRoster(course.id, [{ studentId: STUDENT_ID, studentName: STUDENT_NAME }])
    check('full roster upload immediately enrolls a matching account', (await enrollmentCount()) === 1)

    check('the roster operation removes an existing student', await removeRosterStudent(course.id, STUDENT_ID))
    const [remainingRoster] = await db
      .select({ count: count() })
      .from(courseRoster)
      .where(eq(courseRoster.courseId, course.id))
    check(
      'remove clears roster and enrollment and is safely repeatable',
      remainingRoster.count === 0 && (await enrollmentCount()) === 0 && !await removeRosterStudent(course.id, STUDENT_ID),
    )

    await replaceCourseRoster(course.id, [{ studentId: STUDENT_ID, studentName: STUDENT_NAME }])
    await replaceCourseRoster(course.id, [{ studentId: 'f99999999', studentName: 'No Account Student' }])
    const [replacedRoster] = await db
      .select({ count: count() })
      .from(courseRoster)
      .where(eq(courseRoster.courseId, course.id))
    check(
      'replacement removes stale enrolments while retaining students without accounts',
      replacedRoster.count === 1 && (await enrollmentCount()) === 0,
    )

    // The outage itself: the professor's sheet, parsed the way the upload parses
    // it. Columns Notify | ID | ID Number | Name, the ERP id in "ID", and the
    // ".," salutation prefix on the name.
    const rows = await parseRosterFile(
      sheetFile('Student_List.xlsm', [
        ['Notify', 'ID', 'ID Number', 'Name', 'Level'],
        ['', STUDENT_ERP, STUDENT_CAMPUS, `.,${STUDENT_NAME}`, 'Yr 1 Sem 1'],
      ]),
    )
    check('parser reads the ERP id column and strips the salutation', rows[0]?.studentId === STUDENT_ERP && rows[0]?.studentName === STUDENT_NAME)

    const erpResult = await replaceCourseRoster(course.id, rows)
    check(
      'an ERP-id sheet enrolls the matching account',
      erpResult.enrolled === 1 && erpResult.unmatched.length === 0 && (await enrollmentCount()) === 1,
    )

    // A sheet that only carries the campus id-card number cannot map to an
    // account -- and that has to surface as enrolled: 0, not silent success.
    const campusResult = await replaceCourseRoster(course.id, [
      { studentId: STUDENT_CAMPUS, studentName: STUDENT_NAME },
    ])
    check(
      'a campus-id-only sheet reports zero matches instead of failing silently',
      campusResult.enrolled === 0 && campusResult.unmatched.length === 1 && (await enrollmentCount()) === 0,
    )

    // An email column drives the match even when the id column is unusable.
    const emailRows = await parseRosterFile(
      sheetFile('with_email.xlsx', [
        ['Sl.No', 'ID Number', 'Name', 'Email'],
        ['1', STUDENT_CAMPUS, STUDENT_NAME, STUDENT_EMAIL],
      ]),
    )
    const emailResult = await replaceCourseRoster(course.id, emailRows)
    check(
      'an email column enrolls even when the id column is a campus number',
      emailRows[0]?.email === STUDENT_EMAIL && emailResult.enrolled === 1 && (await enrollmentCount()) === 1,
    )

    // Late sign-in: upload before the account exists, then sync on first login.
    await db.delete(users).where(eq(users.email, LATE_EMAIL))
    const lateUpload = await replaceCourseRoster(course.id, [{ studentId: LATE_ERP, studentName: 'Late Student' }])
    await db.insert(users).values({ email: LATE_EMAIL, name: 'Late Student' }).onConflictDoNothing()
    await syncRosterEnrollment(LATE_EMAIL)
    const [lateEnrolled] = await db
      .select({ count: count() })
      .from(enrollments)
      .where(and(eq(enrollments.courseId, course.id), eq(enrollments.studentEmail, LATE_EMAIL)))
    check(
      'a student who signs in after upload is enrolled by the layout sync',
      lateUpload.enrolled === 0 && lateUpload.unmatched.length === 1 && lateEnrolled.count === 1,
    )
  } finally {
    await db.delete(courses).where(eq(courses.id, course.id))
    await db.delete(users).where(eq(users.email, professor))
    await db.delete(users).where(eq(users.email, LATE_EMAIL))
    if (!existingAccount) await db.delete(users).where(eq(users.email, STUDENT_EMAIL))
  }

  console.log(`${passed}/9 roster checks passed`)
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
