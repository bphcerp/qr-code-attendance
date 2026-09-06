import { sql } from 'drizzle-orm'
import { db } from '@/db'
import { courseRoster, enrollments } from '@/db/schema'
import { studentIdFromEmail } from '@/lib/studentId'

export async function syncRosterEnrollment(email: string) {
  const id = studentIdFromEmail(email)
  if (!id) return

  // Filter in SQL on the student's own ID rather than pulling every roster row
  // on campus into Node and matching in JavaScript. This runs in the app layout
  // on every navigation for every signed-in user, so a full scan here is what
  // falls over first when 600 students open the app at the start of a class. The
  // `lower(replace(...))` expression mirrors normalizeStudentId and matches the
  // one already used in courseRoster.removeRosterStudent.
  const matches = await db
    .select({ courseId: courseRoster.courseId })
    .from(courseRoster)
    .where(sql`lower(replace(${courseRoster.studentId}, ' ', '')) = ${id}`)
  if (!matches.length) return

  await db
    .insert(enrollments)
    .values(matches.map((row) => ({ courseId: row.courseId, studentEmail: email })))
    .onConflictDoNothing()
}
