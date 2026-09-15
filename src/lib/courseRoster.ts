import { and, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/db'
import { courseRoster, enrollments, users } from '@/db/schema'
import { emailCore, emailCoreFromEmail } from '@/lib/studentId'

export type RosterUploadRow = { studentId: string; studentName: string; email?: string }

export type RosterUploadResult = {
  imported: number
  // Roster students who have a signed-in account and were enrolled now.
  enrolled: number
  // Display ids of roster students with no matching account yet. A few of these
  // is normal (they enrol on first sign-in); enrolled === 0 means the sheet's
  // id column does not identify anyone and needs a look before class.
  unmatched: string[]
}

function keyFor(row: RosterUploadRow) {
  return row.email ? emailCoreFromEmail(row.email) : emailCore(row.studentId)
}

// The account-side match key, computed in Postgres from the email local part so
// it lines up with emailCore(): last eight digits of the local part.
const accountKey = sql<string>`right(regexp_replace(split_part(lower(${users.email}), '@', 1), '[^0-9]', '', 'g'), 8)`

export async function replaceCourseRoster(
  courseId: string,
  rows: RosterUploadRow[],
): Promise<RosterUploadResult> {
  const keyByRow = rows.map((row) => ({ row, key: keyFor(row) }))
  const rosterKeys = new Set(keyByRow.map((entry) => entry.key))

  return db.transaction(async (tx) => {
    const existingEnrollments = await tx
      .select({ email: enrollments.studentEmail })
      .from(enrollments)
      .where(eq(enrollments.courseId, courseId))

    await tx.delete(courseRoster).where(eq(courseRoster.courseId, courseId))
    await tx
      .insert(courseRoster)
      .values(keyByRow.map(({ row, key }) => ({ courseId, studentId: row.studentId, studentName: row.studentName, matchKey: key })))

    const staleEmails = existingEnrollments
      .filter((row) => !rosterKeys.has(emailCoreFromEmail(row.email)))
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
    // Match in SQL against the uploaded keys rather than reading the whole users
    // table into Node. The key is the eight-digit email core (studentId.ts), so
    // an ERP id (41120261453), a bare username (f20261453) and a full email all
    // land on the same account -- the mismatch that enrolled nobody before.
    const keys = [...rosterKeys]
    const matchingAccounts = keys.length
      ? await tx
          .select({ email: users.email, key: accountKey })
          .from(users)
          .where(inArray(accountKey, keys))
      : []

    if (matchingAccounts.length) {
      await tx
        .insert(enrollments)
        .values(matchingAccounts.map((account) => ({ courseId, studentEmail: account.email })))
        .onConflictDoNothing()
    }

    const matchedKeys = new Set(matchingAccounts.map((account) => account.key))
    const unmatched = keyByRow
      .filter((entry) => !matchedKeys.has(entry.key))
      .map((entry) => entry.row.studentId)

    return { imported: rows.length, enrolled: matchingAccounts.length, unmatched }
  })
}

export async function removeRosterStudent(courseId: string, value: string) {
  const key = emailCore(value)
  const removed = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ studentId: courseRoster.studentId })
      .from(courseRoster)
      .where(and(eq(courseRoster.courseId, courseId), eq(courseRoster.matchKey, key)))
    if (!existing) return false

    await tx
      .delete(courseRoster)
      .where(and(eq(courseRoster.courseId, courseId), eq(courseRoster.matchKey, key)))

    const enrolled = await tx
      .select({ email: enrollments.studentEmail })
      .from(enrollments)
      .where(eq(enrollments.courseId, courseId))
    const matchingEmails = enrolled
      .filter((row) => emailCoreFromEmail(row.email) === key)
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
