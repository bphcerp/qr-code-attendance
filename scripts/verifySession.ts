import { eq } from 'drizzle-orm'
import { db } from '../src/db'
import { classSessions, courses, users } from '../src/db/schema'
import { isUniqueViolation } from '../src/db/errors'
import { newSessionSecret } from '../src/lib/token'

// The one-open-session-per-course guarantee. The route pre-checks it, but a
// double-click or two co-instructors race past a read-then-insert -- the partial
// unique index is what actually holds. This exercises the index directly against
// the real database.
let passed = 0

function check(label: string, condition: boolean) {
  if (!condition) throw new Error(`FAIL: ${label}`)
  passed++
  console.log(`PASS: ${label}`)
}

async function openSession(courseId: string) {
  return db.insert(classSessions).values({ courseId, secret: newSessionSecret() }).returning({ id: classSessions.id })
}

async function main() {
  const stamp = Date.now()
  const prof = `session.prof.${stamp}@hyderabad.bits-pilani.ac.in`
  await db.insert(users).values({ email: prof, name: 'Session Prof', role: 'faculty' }).onConflictDoNothing()
  const [course] = await db
    .insert(courses)
    .values({ code: `SESS ${stamp}`, title: 'Session Test', facultyEmail: prof })
    .returning({ id: courses.id })

  try {
    const [first] = await openSession(course.id)
    check('the first open session is created', Boolean(first?.id))

    let rejected = false
    try {
      await openSession(course.id)
    } catch (err) {
      rejected = isUniqueViolation(err, 'class_sessions_one_open_per_course')
    }
    check('a second open session for the same course is rejected by the unique index', rejected)

    // Ending the first frees the slot -- the index is partial on ended_at IS NULL.
    await db.update(classSessions).set({ endedAt: new Date() }).where(eq(classSessions.id, first.id))
    const [second] = await openSession(course.id)
    check('a new session starts once the previous one has ended', Boolean(second?.id))
  } finally {
    await db.delete(courses).where(eq(courses.id, course.id))
    await db.delete(users).where(eq(users.email, prof))
  }

  console.log(`${passed}/3 session checks passed`)
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
