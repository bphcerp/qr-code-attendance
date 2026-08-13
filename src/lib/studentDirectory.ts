import { or, sql } from 'drizzle-orm'
import { db } from '@/db'
import { courseRoster, studentDirectory } from '@/db/schema'

export async function searchStudentDirectory(courseId: string, value: string) {
  const query = value.trim().toLowerCase()
  if (query.length < 2 || query.length > 80) return []

  const escaped = escapeLike(query)
  const namePrefix = `${escaped}%`
  const wordPrefix = `% ${escaped}%`
  const emailPrefix = `${escaped}%`
  const nameStarts = sql`lower(${studentDirectory.fullName}) like ${namePrefix} escape '\\'`
  const wordStarts = sql`lower(${studentDirectory.fullName}) like ${wordPrefix} escape '\\'`
  const emailStarts = sql`${studentDirectory.email} like ${emailPrefix} escape '\\'`
  const rosterMatch = sql`${courseRoster.courseId} = ${courseId}
    and lower(replace(${courseRoster.studentId}, ' ', '')) = split_part(${studentDirectory.email}, '@', 1)`

  return db
    .select({
      email: studentDirectory.email,
      fullName: studentDirectory.fullName,
      batch: studentDirectory.batch,
      alreadyAdded: sql<boolean>`${courseRoster.studentId} is not null`,
    })
    .from(studentDirectory)
    .leftJoin(courseRoster, rosterMatch)
    .where(or(nameStarts, wordStarts, emailStarts))
    .orderBy(
      sql`case when ${nameStarts} then 0 when ${wordStarts} then 1 else 2 end`,
      studentDirectory.fullName,
    )
    .limit(8)
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, '\\$&')
}
