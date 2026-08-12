import { and, count, eq } from 'drizzle-orm'
import postgres from 'postgres'
import { db } from '../src/db'
import { courseRoster, courses, enrollments, users } from '../src/db/schema'
import { addDirectoryStudent, removeRosterStudent } from '../src/lib/courseRoster'
import { searchStudentDirectory } from '../src/lib/studentDirectory'

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is not set')

const DIRECTORY_EMAIL = 'f20250558@hyderabad.bits-pilani.ac.in'
const DIRECTORY_ID = 'f20250558'
const DIRECTORY_NAME = 'SUNJAY VARRUN M S'
const sql = postgres(url, { prepare: false })
let passed = 0

function check(label: string, condition: boolean) {
  if (!condition) throw new Error(`FAIL: ${label}`)
  passed++
  console.log(`PASS: ${label}`)
}

async function main() {
  try {
    const [summary] = await sql<{ count: number; invalid: number }[]>`
      select
        count(*)::int as count,
        count(*) filter (
          where email !~ '^f[0-9]{8}@hyderabad\\.bits-pilani\\.ac\\.in$'
             or btrim(full_name) = ''
        )::int as invalid
      from student_directory
    `
    check('all 4,122 vetted Nexus students were migrated', summary.count === 4122)
    check('every directory row has a valid first-degree email and name', summary.invalid === 0)

    const exact = await sql<{ email: string; full_name: string }[]>`
      select email, full_name
      from student_directory
      where email = ${DIRECTORY_EMAIL}
    `
    check('email ID lookup resolves the expected student', exact[0]?.full_name === DIRECTORY_NAME)

    const ranked = await searchStudentDirectory('00000000-0000-0000-0000-000000000000', 'sanjay')
    check('the application search returns ranked matches', ranked.length > 0 && ranked[0].fullName.startsWith('SANJAY'))

    await verifyCourseRosterOperations()
    console.log(`${passed}/10 directory and roster checks passed`)
  } finally {
    await sql.end()
  }
}

async function verifyCourseRosterOperations() {
  const stamp = Date.now()
  const professor = `directory.prof.${stamp}@hyderabad.bits-pilani.ac.in`
  const [existingAccount] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.email, DIRECTORY_EMAIL))

  await db.insert(users).values([
    { email: professor, name: 'Directory Test Professor', role: 'faculty' },
    { email: DIRECTORY_EMAIL, name: DIRECTORY_NAME },
  ]).onConflictDoNothing()

  const [course] = await db
    .insert(courses)
    .values({ code: `DIR ${stamp}`, title: 'Directory Test', facultyEmail: professor })
    .returning({ id: courses.id })

  try {
    const before = await searchStudentDirectory(course.id, DIRECTORY_ID)
    check('a directory result starts outside the course', before[0]?.alreadyAdded === false)

    const added = await addDirectoryStudent(course.id, DIRECTORY_EMAIL)
    check('adding returns the expected roster identity', added?.studentId === DIRECTORY_ID && added.studentName === DIRECTORY_NAME)
    await addDirectoryStudent(course.id, DIRECTORY_EMAIL)

    const [rosterSummary] = await db
      .select({ count: count() })
      .from(courseRoster)
      .where(and(eq(courseRoster.courseId, course.id), eq(courseRoster.studentId, DIRECTORY_ID)))
    const [enrollmentSummary] = await db
      .select({ count: count() })
      .from(enrollments)
      .where(and(eq(enrollments.courseId, course.id), eq(enrollments.studentEmail, DIRECTORY_EMAIL)))
    check('repeat add stays idempotent and enrolls an existing account', rosterSummary.count === 1 && enrollmentSummary.count === 1)

    const after = await searchStudentDirectory(course.id, DIRECTORY_ID)
    check('search marks the added student as in the course', after[0]?.alreadyAdded === true)

    check('the roster operation removes an existing student', await removeRosterStudent(course.id, DIRECTORY_ID))
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
      remainingRoster.count === 0 && remainingEnrollments.count === 0 && !await removeRosterStudent(course.id, DIRECTORY_ID),
    )
  } finally {
    await db.delete(courses).where(eq(courses.id, course.id))
    await db.delete(users).where(eq(users.email, professor))
    if (!existingAccount) await db.delete(users).where(eq(users.email, DIRECTORY_EMAIL))
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
