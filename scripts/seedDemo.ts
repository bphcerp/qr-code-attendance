import { and, eq } from 'drizzle-orm'
import { db } from '../src/db'
import { users, courses, enrollments } from '../src/db/schema'

// Dev only. There is no course-creation UI yet, and testing the whole loop on
// one Google account means being both the faculty who starts the session and
// the student who scans it -- artificial, but it is the only way to drive the
// projector and the phone from a single login. Idempotent.
//
//   npx tsx --env-file=.env.local scripts/seedDemo.ts you@hyderabad.bits-pilani.ac.in

const CODE = 'CS F211'
const TITLE = 'Data Structures'

async function main() {
  const email = (process.argv[2] ?? process.env.DEMO_EMAIL ?? '').trim().toLowerCase()
  if (!email) {
    console.error('usage: seedDemo.ts <email>')
    process.exit(1)
  }

  // Unlike seedAdmin, this creates the row if it is missing: the whole point is
  // to have data waiting before the first sign-in.
  await db
    .insert(users)
    .values({ email, name: email.split('@')[0], role: 'faculty', campus: email.split('@')[1] })
    .onConflictDoUpdate({ target: users.email, set: { role: 'faculty' } })

  const [existing] = await db
    .select({ id: courses.id })
    .from(courses)
    .where(and(eq(courses.code, CODE), eq(courses.facultyEmail, email)))

  const course =
    existing ??
    (
      await db
        .insert(courses)
        .values({ code: CODE, title: TITLE, facultyEmail: email })
        .returning({ id: courses.id })
    )[0]

  await db
    .insert(enrollments)
    .values({ courseId: course.id, studentEmail: email })
    .onConflictDoNothing()

  console.log(`${email} is faculty and enrolled in ${CODE}`)
  console.log(`control page: /courses/${course.id}/session`)
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
