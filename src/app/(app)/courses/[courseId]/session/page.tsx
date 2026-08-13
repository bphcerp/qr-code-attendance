import { notFound, redirect } from 'next/navigation'
import { and, count, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm'
import { db } from '@/db'
import { attendanceRecords, classSessions, courseRoster, courses, enrollments } from '@/db/schema'
import { auth } from '@/lib/auth'
import { getCurrentUser } from '@/lib/currentUser'
import SessionControl from '@/components/SessionControl'
import CourseRosterUpload from '@/components/CourseRosterUpload'
import AttendanceHistory, { type HistoryRow } from '@/components/AttendanceHistory'

export const dynamic = 'force-dynamic'

export default async function SessionPage({
  params,
}: {
  params: Promise<{ courseId: string }>
}) {
  const { courseId } = await params
  const signedIn = await auth()
  const email = signedIn?.user?.email?.toLowerCase()
  if (!email) redirect('/login')

  // course and open-session are independent of each other and of `me` -- the
  // parent layout already fetched `me` for this request, so getCurrentUser()
  // is a cache() hit rather than a fourth round trip.
  const [me, [course], [open], [rosterCount], [enrollmentCount], rosterRows, sessions] = await Promise.all([
    getCurrentUser(email),
    db
      .select({
        id: courses.id,
        code: courses.code,
        title: courses.title,
        facultyEmail: courses.facultyEmail,
      })
      .from(courses)
      .where(eq(courses.id, courseId)),
    db
      .select({
        id: classSessions.id,
        startedAt: classSessions.startedAt,
        rotationSeconds: classSessions.rotationSeconds,
        declaredDisplayCount: classSessions.declaredDisplayCount,
      })
      .from(classSessions)
      .where(and(eq(classSessions.courseId, courseId), isNull(classSessions.endedAt))),
    db
      .select({ count: count() })
      .from(courseRoster)
      .where(eq(courseRoster.courseId, courseId)),
    db
      .select({ count: count() })
      .from(enrollments)
      .where(eq(enrollments.courseId, courseId)),
    db
      .select({ studentId: courseRoster.studentId, studentName: courseRoster.studentName })
      .from(courseRoster)
      .where(eq(courseRoster.courseId, courseId))
      .orderBy(courseRoster.studentName, courseRoster.studentId),
    db
      .select({ id: classSessions.id, startedAt: classSessions.startedAt, endedAt: classSessions.endedAt })
      .from(classSessions)
      .where(and(eq(classSessions.courseId, courseId), isNotNull(classSessions.endedAt)))
      .orderBy(desc(classSessions.startedAt)),
  ])

  // 404 rather than 403 on someone else's course: a wrong answer here tells the
  // asker the course exists, which is the thing they were fishing for.
  if (!course) notFound()
  if (me?.role !== 'admin' && course.facultyEmail.toLowerCase() !== email) notFound()

  const sessionIds = sessions.map((session) => session.id)
  const attendanceCounts = sessionIds.length
    ? await db
        .select({ sessionId: attendanceRecords.sessionId, count: count() })
        .from(attendanceRecords)
        .where(inArray(attendanceRecords.sessionId, sessionIds))
        .groupBy(attendanceRecords.sessionId)
    : []
  const countBySession = new Map(attendanceCounts.map((row) => [row.sessionId, row.count]))
  const roster = (rosterCount?.count ?? 0) > 0 ? rosterCount.count : (enrollmentCount?.count ?? 0)
  const history: HistoryRow[] = sessions.map((session) => ({
    id: session.id,
    startedAt: session.startedAt.toISOString(),
    endedAt: session.endedAt?.toISOString() ?? null,
    present: countBySession.get(session.id) ?? 0,
    roster,
  }))

  return (
    <div className="space-y-6 py-8">
      <SessionControl
        courseId={course.id}
        courseCode={course.code}
        courseTitle={course.title}
        openSession={open ? { ...open, startedAt: open.startedAt.toISOString() } : null}
      />
      <CourseRosterUpload
        courseId={course.id}
        initialRoster={rosterRows}
      />
      <AttendanceHistory rows={history} />
    </div>
  )
}
