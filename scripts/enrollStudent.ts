import { and, eq } from 'drizzle-orm'
import { db } from '../src/db'
import { users, courses, enrollments } from '../src/db/schema'

// Adds a student to an existing course. seedDemo makes one account both sides
// of the loop, which is enough to prove the plumbing but not to test what
// actually happens in a lecture -- for that you want a second account that is
// only ever a student. Idempotent.
//
//   npx tsx --env-file=.env.local scripts/enrollStudent.ts someone@example.com "CS F211"

async function main() {
  const email = (process.argv[2] ?? '').trim().toLowerCase()
  const code = (process.argv[3] ?? 'CS F211').trim()
  if (!email) {
    console.error('usage: enrollStudent.ts <email> [courseCode]')
    process.exit(1)
  }

  const [course] = await db.select({ id: courses.id }).from(courses).where(eq(courses.code, code))
  if (!course) {
    console.error(`no course with code ${code}`)
    process.exit(1)
  }

  // Role is left alone if the account already exists -- promoting or demoting
  // someone as a side effect of enrolling them is exactly the kind of silent
  // privilege change the role rules exist to prevent.
  await db
    .insert(users)
    .values({ email, name: email.split('@')[0], role: 'student' })
    .onConflictDoNothing()

  await db
    .insert(enrollments)
    .values({ courseId: course.id, studentEmail: email })
    .onConflictDoNothing()

  const [row] = await db.select({ role: users.role }).from(users).where(eq(users.email, email))
  const [check] = await db
    .select({ courseId: enrollments.courseId })
    .from(enrollments)
    .where(and(eq(enrollments.courseId, course.id), eq(enrollments.studentEmail, email)))

  console.log(`${email} is ${row.role}, enrolled in ${code}: ${Boolean(check)}`)
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
