import { db } from '@/db'
import { courseRoster, enrollments } from '@/db/schema'
import { normalizeStudentId, studentIdFromEmail } from '@/lib/studentId'

export async function syncRosterEnrollment(email: string) {
  const id = studentIdFromEmail(email)
  if (!id) return

  const roster = await db
    .select({ courseId: courseRoster.courseId, studentId: courseRoster.studentId })
    .from(courseRoster)
  const matches = roster
    .filter((row) => normalizeStudentId(row.studentId) === id)
    .map((row) => ({ courseId: row.courseId, studentEmail: email }))
  if (!matches.length) return

  await db.insert(enrollments).values(matches).onConflictDoNothing()
}
