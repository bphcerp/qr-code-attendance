import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { and, count, eq, inArray, isNotNull } from 'drizzle-orm'
import { db } from '@/db'
import { attendanceRecords, classSessions, courseRoster, courses, enrollments } from '@/db/schema'
import { auth } from '@/lib/auth'
import AttendanceHistory, { type HistoryRow } from '@/components/AttendanceHistory'

export const dynamic = 'force-dynamic'

export default async function CoursePage({
  params,
}: {
  params: Promise<{ courseId: string }>
}) {
  const { courseId } = await params
  const session = await auth()
  const email = session?.user?.email?.toLowerCase()
  if (!email) redirect('/login')

  const [[course], [enrolled], [rosterCount], [enrollmentCount], sessions] = await Promise.all([
    db
      .select({ code: courses.code, title: courses.title })
      .from(courses)
      .where(eq(courses.id, courseId)),
    db
      .select({ courseId: enrollments.courseId })
      .from(enrollments)
      .where(and(eq(enrollments.courseId, courseId), eq(enrollments.studentEmail, email))),
    db
      .select({ count: count() })
      .from(courseRoster)
      .where(eq(courseRoster.courseId, courseId)),
    db
      .select({ count: count() })
      .from(enrollments)
      .where(eq(enrollments.courseId, courseId)),
    db
      .select({ id: classSessions.id, startedAt: classSessions.startedAt, endedAt: classSessions.endedAt })
      .from(classSessions)
      .where(and(eq(classSessions.courseId, courseId), isNotNull(classSessions.endedAt)))
      .orderBy(classSessions.startedAt),
  ])

  if (!course || !enrolled) notFound()

  const sessionIds = sessions.map((item) => item.id)
  const attendance = sessionIds.length
    ? await db
        .select({ sessionId: attendanceRecords.sessionId })
        .from(attendanceRecords)
        .where(
          and(inArray(attendanceRecords.sessionId, sessionIds), eq(attendanceRecords.studentEmail, email)),
        )
    : []
  const attended = new Set(attendance.map((row) => row.sessionId))
  const roster = (rosterCount?.count ?? 0) > 0 ? rosterCount.count : (enrollmentCount?.count ?? 0)
  const history: HistoryRow[] = sessions.map((item) => ({
    id: item.id,
    startedAt: item.startedAt.toISOString(),
    endedAt: item.endedAt?.toISOString() ?? null,
    present: attended.has(item.id) ? 1 : 0,
    roster,
    studentPresent: attended.has(item.id),
  }))

  return (
    <div className="space-y-6 py-8">
      <div>
        <Link href="/" className="text-sm font-semibold text-primary hover:underline">
          ← Back to courses
        </Link>
        <h1 className="page-title mt-5">{course.code}</h1>
        <p className="mt-1 text-muted-foreground">{course.title}</p>
      </div>
      <AttendanceHistory rows={history} studentView />
    </div>
  )
}
