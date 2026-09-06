import { and, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/db'
import { courseRoster, enrollments, users } from '@/db/schema'
import { normalizeStudentId, studentIdFromEmail } from '@/lib/studentId'

export async function replaceCourseRoster(
  courseId: string,
  rows: { studentId: string; studentName: string }[],
) {
  await db.transaction(async (tx) => {
    const existingEnrollments = await tx
      .select({ email: enrollments.studentEmail })
      .from(enrollments)
      .where(eq(enrollments.courseId, courseId))

    await tx.delete(courseRoster).where(eq(courseRoster.courseId, courseId))
    await tx.insert(courseRoster).values(rows.map((row) => ({ courseId, ...row })))

    const rosterIds = new Set(rows.map((row) => normalizeStudentId(row.studentId)))
    const staleEmails = existingEnrollments
      .filter((row) => !rosterIds.has(studentIdFromEmail(row.email)))
      .map((row) => row.email)

    if (staleEmails.length) {
      await tx
        .delete(enrollments)
        .where(and(eq(enrollments.courseId, courseId), inArray(enrollments.studentEmail, staleEmails)))
    }

    // Enrol matching accounts now. Relying only on the app-layout sync means a
    // student with an already-mounted layout does not see the new course until
    // a full reload or their next sign-in.
    //
    // Match in SQL against the uploaded IDs rather than reading the whole users
    // table into Node -- the same full-scan-then-filter pattern the layout sync
    // had. The `lower(replace(split_part(...)))` expression is normalizeStudentId
    // applied to the email local part, in Postgres.
    const ids = [...rosterIds]
    const matchingAccounts = ids.length
      ? await tx
          .select({ email: users.email })
          .from(users)
          .where(
            inArray(
              sql`lower(replace(split_part(${users.email}, '@', 1), ' ', ''))`,
              ids,
            ),
          )
      : []

    if (matchingAccounts.length) {
      await tx
        .insert(enrollments)
        .values(matchingAccounts.map((account) => ({ courseId, studentEmail: account.email })))
        .onConflictDoNothing()
    }
  })
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
