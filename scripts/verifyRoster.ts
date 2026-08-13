import { and, count, eq } from 'drizzle-orm'
import { db } from '../src/db'
import { courseRoster, courses, enrollments, users } from '../src/db/schema'
import { removeRosterStudent, replaceCourseRoster } from '../src/lib/courseRoster'

const STUDENT_EMAIL = 'f20250558@hyderabad.bits-pilani.ac.in'
const STUDENT_ID = 'f20250558'
const STUDENT_NAME = 'SUNJAY VARRUN M S'
let passed = 0

function check(label: string, condition: boolean) {
  if (!condition) throw new Error(`FAIL: ${label}`)
  passed++
  console.log(`PASS: ${label}`)
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

  try {
    await replaceCourseRoster(course.id, [{ studentId: STUDENT_ID, studentName: STUDENT_NAME }])
    const [uploadedEnrollment] = await db
      .select({ count: count() })
      .from(enrollments)
      .where(and(eq(enrollments.courseId, course.id), eq(enrollments.studentEmail, STUDENT_EMAIL)))
    check('full roster upload immediately enrolls a matching account', uploadedEnrollment.count === 1)

    check('the roster operation removes an existing student', await removeRosterStudent(course.id, STUDENT_ID))
    const [remainingRoster] = await db
      .select({ count: count() })
      .from(courseRoster)
      .where(eq(courseRoster.courseId, course.id))
    const [remainingEnrollments] = await db
      .select({ count: count() })
      .from(enrollments)
      .where(eq(enrollments.courseId, course.id))
    check(
      'remove clears roster and enrollment and is safely repeatable',
      remainingRoster.count === 0 && remainingEnrollments.count === 0 && !await removeRosterStudent(course.id, STUDENT_ID),
    )

    await replaceCourseRoster(course.id, [{ studentId: STUDENT_ID, studentName: STUDENT_NAME }])
    await replaceCourseRoster(course.id, [{ studentId: 'f99999999', studentName: 'No Account Student' }])
    const [replacedRoster] = await db
      .select({ count: count() })
      .from(courseRoster)
      .where(eq(courseRoster.courseId, course.id))
    const [replacedEnrollments] = await db
      .select({ count: count() })
      .from(enrollments)
      .where(eq(enrollments.courseId, course.id))
    check(
      'replacement removes stale enrolments while retaining students without accounts',
      replacedRoster.count === 1 && replacedEnrollments.count === 0,
    )
  } finally {
    await db.delete(courses).where(eq(courses.id, course.id))
    await db.delete(users).where(eq(users.email, professor))
    if (!existingAccount) await db.delete(users).where(eq(users.email, STUDENT_EMAIL))
  }

  console.log(`${passed}/4 roster checks passed`)
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
