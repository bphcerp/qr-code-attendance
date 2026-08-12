import { and, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/db'
import { courseRoster, enrollments, studentDirectory, users } from '@/db/schema'
import { normalizeStudentId, studentIdFromEmail } from '@/lib/studentId'

export async function addDirectoryStudent(courseId: string, email: string) {
  const [student] = await db
    .select({ email: studentDirectory.email, fullName: studentDirectory.fullName })
    .from(studentDirectory)
    .where(eq(studentDirectory.email, email))
  if (!student) return null

  const studentId = studentIdFromEmail(student.email)
  const row = { studentId, studentName: student.fullName }

  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ studentId: courseRoster.studentId })
      .from(courseRoster)
      .where(and(
        eq(courseRoster.courseId, courseId),
        sql`lower(replace(${courseRoster.studentId}, ' ', '')) = ${studentId}`,
      ))

    if (existing) {
      await tx
        .update(courseRoster)
        .set({ studentName: student.fullName })
        .where(and(eq(courseRoster.courseId, courseId), eq(courseRoster.studentId, existing.studentId)))
    } else {
      await tx.insert(courseRoster).values({ courseId, ...row })
    }

    const [account] = await tx
      .select({ email: users.email })
      .from(users)
      .where(sql`lower(${users.email}) = ${student.email}`)
    if (account) {
      await tx
        .insert(enrollments)
        .values({ courseId, studentEmail: account.email })
        .onConflictDoNothing()
    }
  })

  return row
}

export async function removeRosterStudent(courseId: string, value: string) {
  const studentId = normalizeStudentId(value)
  const removed = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ studentId: courseRoster.studentId })
      .from(courseRoster)
      .where(and(
        eq(courseRoster.courseId, courseId),
        sql`lower(replace(${courseRoster.studentId}, ' ', '')) = ${studentId}`,
      ))
    if (!existing) return false

    await tx
      .delete(courseRoster)
      .where(and(eq(courseRoster.courseId, courseId), eq(courseRoster.studentId, existing.studentId)))

    const enrolled = await tx
      .select({ email: enrollments.studentEmail })
      .from(enrollments)
      .where(eq(enrollments.courseId, courseId))
    const matchingEmails = enrolled
      .filter((row) => studentIdFromEmail(row.email) === studentId)
      .map((row) => row.email)
    if (matchingEmails.length) {
      await tx
        .delete(enrollments)
        .where(and(eq(enrollments.courseId, courseId), inArray(enrollments.studentEmail, matchingEmails)))
    }

    return true
  })

  return removed
}
