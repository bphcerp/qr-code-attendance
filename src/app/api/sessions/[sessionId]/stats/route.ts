import { and, count, eq } from 'drizzle-orm'
import { db } from '@/db'
import {
  attendanceFlags,
  attendanceRecords,
  classSessions,
  courses,
  enrollments,
  users,
} from '@/db/schema'
import { errorResponse, requireRole, HttpError } from '@/lib/guards'
import { activeDisplayCount } from '@/lib/displayToken'

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
    const { email, role } = await requireRole('faculty', 'admin')

    const [session] = await db
      .select({
        courseId: classSessions.courseId,
        facultyEmail: courses.facultyEmail,
        startedAt: classSessions.startedAt,
        endedAt: classSessions.endedAt,
        declaredDisplayCount: classSessions.declaredDisplayCount,
      })
      .from(classSessions)
      .innerJoin(courses, eq(courses.id, classSessions.courseId))
      .where(eq(classSessions.id, sessionId))
    if (!session) throw new HttpError(404, 'not_found')
    if (role !== 'admin' && session.facultyEmail.toLowerCase() !== email) {
      throw new HttpError(403, 'forbidden')
    }

    const [students, flags, activeDisplays] = await Promise.all([
      db
        .select({
          email: enrollments.studentEmail,
          name: users.name,
          markedAt: attendanceRecords.markedAt,
          source: attendanceRecords.source,
        })
        .from(enrollments)
        .innerJoin(users, eq(users.email, enrollments.studentEmail))
        .leftJoin(
          attendanceRecords,
          and(
            eq(attendanceRecords.sessionId, sessionId),
            eq(attendanceRecords.studentEmail, enrollments.studentEmail),
          ),
        )
        .where(eq(enrollments.courseId, session.courseId))
        .orderBy(users.name, users.email),
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
    const bySource: Record<string, number> = {}
    let marked = 0
    for (const student of students) {
      if (!student.source) continue
      marked++
      bySource[student.source] = (bySource[student.source] ?? 0) + 1
    }

    return Response.json(
      {
        marked,
        roster: students.length,
        bySource,
        students: students
          .map((student) => ({
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
