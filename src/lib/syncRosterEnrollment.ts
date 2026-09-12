import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { courseRoster, enrollments } from '@/db/schema'
import { emailCoreFromEmail } from '@/lib/studentId'

export async function syncRosterEnrollment(email: string) {
  const key = emailCoreFromEmail(email)
  if (!key) return

  // Resolve this student against every roster by the stored match key -- one
  // indexed equality on course_roster.match_key. This runs in the app layout on
  // every navigation for every signed-in user, so the old full scan with a
  // lower(replace(...)) expression is exactly what fell over first when 600
  // students opened the app at the start of a class. The key is the eight-digit
  // email core (studentId.ts), which is what a roster's ERP id or username was
  // reduced to at upload.
  const matches = await db
    .select({ courseId: courseRoster.courseId })
    .from(courseRoster)
    .where(eq(courseRoster.matchKey, key))
  if (!matches.length) return

  await db
    .insert(enrollments)
    .values(matches.map((row) => ({ courseId: row.courseId, studentEmail: email })))
    .onConflictDoNothing()
}
