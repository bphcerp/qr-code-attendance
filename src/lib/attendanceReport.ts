import { and, asc, eq, isNotNull } from 'drizzle-orm'
import { db } from '@/db'
import { attendanceRecords, classSessions, courseRoster, enrollments, users } from '@/db/schema'
import { normalizeStudentId, studentIdFromEmail } from '@/lib/studentId'

export type ReportSession = {
  id: string
  startedAt: string
}

export type ReportStudent = {
  studentId: string
  name: string
  email: string | null
  // false for someone who marked attendance but is missing from the uploaded
  // roster -- their record is real and must not vanish from the report.
  onRoster: boolean
  // index-aligned with `sessions`: the ISO time they marked, or null for absent
  marks: (string | null)[]
  present: number
}

export type AttendanceReport = {
  sessions: ReportSession[]
  students: ReportStudent[]
  // index-aligned with `sessions`
  presentBySession: number[]
}

// Every student against every completed class, for the faculty course page.
// Only ended sessions count: a class still running has a number that changes
// under the reader, and the attendance percentage on the student home page is
// computed over ended sessions too, so including a live one here would make the
// two screens disagree.
export async function getCourseAttendanceReport(courseId: string): Promise<AttendanceReport> {
  const [sessionRows, roster, enrolledStudents, attendance] = await Promise.all([
    db
      .select({ id: classSessions.id, startedAt: classSessions.startedAt })
      .from(classSessions)
      .where(and(eq(classSessions.courseId, courseId), isNotNull(classSessions.endedAt)))
      // oldest first: the grid reads left to right through the term, unlike the
      // session-by-session history table, which leads with the latest class.
      .orderBy(asc(classSessions.startedAt)),
    db
      .select({ studentId: courseRoster.studentId, name: courseRoster.studentName })
      .from(courseRoster)
      .where(eq(courseRoster.courseId, courseId))
      .orderBy(courseRoster.studentName, courseRoster.studentId),
    db
      .select({ email: enrollments.studentEmail, name: users.name })
      .from(enrollments)
      .innerJoin(users, eq(users.email, enrollments.studentEmail))
      .where(eq(enrollments.courseId, courseId))
      .orderBy(users.name, users.email),
    db
      .select({
        sessionId: attendanceRecords.sessionId,
        email: attendanceRecords.studentEmail,
        name: users.name,
        markedAt: attendanceRecords.markedAt,
      })
      .from(attendanceRecords)
      .innerJoin(classSessions, eq(classSessions.id, attendanceRecords.sessionId))
      .innerJoin(users, eq(users.email, attendanceRecords.studentEmail))
      .where(and(eq(classSessions.courseId, courseId), isNotNull(classSessions.endedAt))),
  ])

  const sessions: ReportSession[] = sessionRows.map((session) => ({
    id: session.id,
    startedAt: session.startedAt.toISOString(),
  }))
  const columnOf = new Map(sessions.map((session, index) => [session.id, index]))

  // Attendance is keyed by email, the uploaded roster by student id, so the two
  // meet on the id derived from the local part of the address.
  const marksByStudent = new Map<
    string,
    { email: string; name: string; byColumn: Map<number, string> }
  >()
  for (const record of attendance) {
    const column = columnOf.get(record.sessionId)
    if (column === undefined) continue
    const id = studentIdFromEmail(record.email)
    let entry = marksByStudent.get(id)
    if (!entry) {
      entry = { email: record.email, name: record.name, byColumn: new Map() }
      marksByStudent.set(id, entry)
    }
    entry.byColumn.set(column, record.markedAt.toISOString())
  }

  const presentBySession = sessions.map(() => 0)
  const students: ReportStudent[] = []
  const listed = new Set<string>()

  function addStudent(id: string, studentId: string, name: string, email: string | null, onRoster: boolean) {
    listed.add(id)
    const entry = marksByStudent.get(id)
    let present = 0
    const marks = sessions.map((_, column) => {
      const markedAt = entry?.byColumn.get(column) ?? null
      if (markedAt) {
        present++
        presentBySession[column]++
      }
      return markedAt
    })
    students.push({ studentId, name, email: entry?.email ?? email, onRoster, present, marks })
  }

  // Same denominator rule as the live session stats and both course pages: the
  // uploaded roster when there is one, otherwise the accounts enrolled.
  if (roster.length) {
    for (const student of roster) {
      addStudent(normalizeStudentId(student.studentId), student.studentId, student.name, null, true)
    }
  } else {
    for (const student of enrolledStudents) {
      addStudent(studentIdFromEmail(student.email), studentIdFromEmail(student.email), student.name, student.email, true)
    }
  }

  const offRoster = [...marksByStudent.entries()]
    .filter(([id]) => !listed.has(id))
    .sort((a, b) => a[1].name.localeCompare(b[1].name) || a[0].localeCompare(b[0]))
  for (const [id, entry] of offRoster) {
    addStudent(id, id, entry.name, entry.email, false)
  }

  return { sessions, students, presentBySession }
}
