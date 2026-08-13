import { count, eq } from 'drizzle-orm'
import { db } from '@/db'
import {
  attendanceFlags,
  attendanceRecords,
  classSessions,
  courseRoster,
  enrollments,
  users,
} from '@/db/schema'
import { errorResponse, requireCourseAccess, requireRole, HttpError } from '@/lib/guards'
import { activeDisplayCount } from '@/lib/displayToken'
import { studentIdFromEmail } from '@/lib/studentId'

export const dynamic = 'force-dynamic'

/**
 * What the control page polls while a class is running. Everything here is
 * counted in Postgres rather than held per-instance -- on serverless the
 * request that answers this one shares no memory with the poll before it.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  try {
    const { sessionId } = await params

    // Authenticate before the lookup, so a signed-out caller can't tell a real
    // session id from a made-up one by the difference between 404 and 403.
    await requireRole('faculty', 'admin')

    const [session] = await db
      .select({
        courseId: classSessions.courseId,
        startedAt: classSessions.startedAt,
        endedAt: classSessions.endedAt,
        declaredDisplayCount: classSessions.declaredDisplayCount,
      })
      .from(classSessions)
      .where(eq(classSessions.id, sessionId))
    if (!session) throw new HttpError(404, 'not_found')
    await requireCourseAccess(session.courseId)

    const [roster, enrolledStudents, attendance, flags, activeDisplays] = await Promise.all([
      db
        .select({
          studentId: courseRoster.studentId,
          name: courseRoster.studentName,
        })
        .from(courseRoster)
        .where(eq(courseRoster.courseId, session.courseId))
        .orderBy(courseRoster.studentName, courseRoster.studentId),
      db
        .select({ email: enrollments.studentEmail, name: users.name })
        .from(enrollments)
        .innerJoin(users, eq(users.email, enrollments.studentEmail))
        .where(eq(enrollments.courseId, session.courseId))
        .orderBy(users.name, users.email),
      db
        .select({
          email: attendanceRecords.studentEmail,
          markedAt: attendanceRecords.markedAt,
          source: attendanceRecords.source,
        })
        .from(attendanceRecords)
        .where(eq(attendanceRecords.sessionId, sessionId)),
      db
        .select({ kind: attendanceFlags.kind, n: count() })
        .from(attendanceFlags)
        .innerJoin(attendanceRecords, eq(attendanceRecords.id, attendanceFlags.recordId))
        .where(eq(attendanceRecords.sessionId, sessionId))
        .groupBy(attendanceFlags.kind),
      activeDisplayCount(sessionId),
    ])

    // The roster rows already carry attendance source, so derive the summary
    // here instead of making Postgres scan attendance_records a second time.
    const attendanceByStudent = new Map(
      attendance.map((record) => [studentIdFromEmail(record.email), record]),
    )
    const visibleStudents = roster.length
      ? roster.map((student) => {
          const record = attendanceByStudent.get(studentIdFromEmail(student.studentId))
          return {
            studentId: student.studentId,
            email: record?.email ?? null,
            name: student.name,
            markedAt: record?.markedAt ?? null,
            source: record?.source ?? null,
          }
        })
      : enrolledStudents.map((student) => {
          const record = attendanceByStudent.get(studentIdFromEmail(student.email))
          return {
            studentId: studentIdFromEmail(student.email),
            email: student.email,
            name: student.name,
            markedAt: record?.markedAt ?? null,
            source: record?.source ?? null,
          }
        })

    const bySource: Record<string, number> = {}
    let marked = 0
    for (const student of visibleStudents) {
      if (!student.source) continue
      marked++
      bySource[student.source] = (bySource[student.source] ?? 0) + 1
    }

    return Response.json(
      {
        marked,
        roster: visibleStudents.length,
        bySource,
        students: visibleStudents
          .map((student) => ({
            studentId: student.studentId,
            email: student.email,
            name: student.name,
            markedAt: student.markedAt?.toISOString() ?? null,
            source: student.source,
          })),
        flags: flags.map((row) => ({ kind: row.kind, count: row.n })),
        activeDisplays,
        declaredDisplayCount: session.declaredDisplayCount,
        startedAt: session.startedAt.toISOString(),
        endedAt: session.endedAt?.toISOString() ?? null,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    return errorResponse(err)
  }
}
