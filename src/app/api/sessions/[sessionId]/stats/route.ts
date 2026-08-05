import { count, eq } from 'drizzle-orm'
import { db } from '@/db'
import { attendanceFlags, attendanceRecords, classSessions, enrollments } from '@/db/schema'
import { errorResponse, requireCourseAccess, requireUser, HttpError } from '@/lib/guards'
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
    await requireUser()

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

    const bySource = await db
      .select({ source: attendanceRecords.source, n: count() })
      .from(attendanceRecords)
      .where(eq(attendanceRecords.sessionId, sessionId))
      .groupBy(attendanceRecords.source)

    const flags = await db
      .select({ kind: attendanceFlags.kind, n: count() })
      .from(attendanceFlags)
      .innerJoin(attendanceRecords, eq(attendanceRecords.id, attendanceFlags.recordId))
      .where(eq(attendanceRecords.sessionId, sessionId))
      .groupBy(attendanceFlags.kind)

    const [roster] = await db
      .select({ n: count() })
      .from(enrollments)
      .where(eq(enrollments.courseId, session.courseId))

    return Response.json(
      {
        marked: bySource.reduce((total, row) => total + row.n, 0),
        roster: roster?.n ?? 0,
        bySource: Object.fromEntries(bySource.map((row) => [row.source, row.n])),
        flags: flags.map((row) => ({ kind: row.kind, count: row.n })),
        activeDisplays: await activeDisplayCount(sessionId),
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
