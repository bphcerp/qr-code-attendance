import Link from 'next/link'
import { redirect } from 'next/navigation'
import { and, count, eq, inArray, isNotNull, isNull } from 'drizzle-orm'
import { db } from '@/db'
import { attendanceRecords, classSessions, courses, enrollments } from '@/db/schema'
import { auth } from '@/lib/auth'
import { getCurrentUser } from '@/lib/currentUser'
import StatusChip from '@/components/StatusChip'
import { Button } from '@/components/ui/button'

export const dynamic = 'force-dynamic'

export default async function HomePage() {
  const session = await auth()
  const email = session?.user?.email?.toLowerCase()
  if (!email) redirect('/login')

  const me = await getCurrentUser(email)
  if (!me) redirect('/login')

  return me.role === 'student' ? <StudentHome email={email} /> : <FacultyHome email={email} />
}

async function StudentHome({ email }: { email: string }) {
  const enrolled = await db
    .select({ id: courses.id, code: courses.code, title: courses.title })
    .from(enrollments)
    .innerJoin(courses, eq(courses.id, enrollments.courseId))
    .where(eq(enrollments.studentEmail, email))
    .orderBy(courses.code)

  if (!enrolled.length) {
    return (
      <>
        <div className="my-8">
          <h1 className="page-title">Your courses</h1>
        </div>
        <p className="text-muted-foreground">
          You aren&rsquo;t enrolled in anything yet. Your instructor imports the roster.
        </p>
      </>
    )
  }

  const ids = enrolled.map((c) => c.id)

  // Percentages count finished sessions only -- a class that is still running
  // would otherwise read as a miss for everyone who hasn't scanned yet.
  const [live, held, attended] = await Promise.all([
    db
      .select({ id: classSessions.id, courseId: classSessions.courseId })
      .from(classSessions)
      .where(and(inArray(classSessions.courseId, ids), isNull(classSessions.endedAt))),
    db
      .select({ courseId: classSessions.courseId, n: count() })
      .from(classSessions)
      .where(and(inArray(classSessions.courseId, ids), isNotNull(classSessions.endedAt)))
      .groupBy(classSessions.courseId),
    db
      .select({ courseId: classSessions.courseId, n: count() })
      .from(attendanceRecords)
      .innerJoin(classSessions, eq(classSessions.id, attendanceRecords.sessionId))
      .where(
        and(
          eq(attendanceRecords.studentEmail, email),
          inArray(classSessions.courseId, ids),
          isNotNull(classSessions.endedAt),
        ),
      )
      .groupBy(classSessions.courseId),
  ])

  const liveByCourse = new Map(live.map((s) => [s.courseId, s.id]))
  const heldByCourse = new Map(held.map((r) => [r.courseId, r.n]))
  const attendedByCourse = new Map(attended.map((r) => [r.courseId, r.n]))

  return (
    <>
      <div className="my-8">
        <h1 className="page-title">Your courses</h1>
      </div>

      {live.length > 0 && (
        <div className="mb-6 rounded-lg border border-border bg-card p-5 shadow-[var(--shadow)]">
          <div className="flex items-center gap-3">
            <StatusChip tone="live">Taking attendance</StatusChip>
            <span className="text-sm text-muted-foreground">
              {live.length === 1
                ? enrolled.find((c) => c.id === live[0].courseId)?.code
                : `${live.length} classes`}
            </span>
          </div>
          <Button asChild size="lg" className="mt-4 h-12 w-full text-base sm:w-auto sm:px-8">
            <Link href="/scan">Scan now</Link>
          </Button>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {enrolled.map((course) => {
          const total = heldByCourse.get(course.id) ?? 0
          const present = attendedByCourse.get(course.id) ?? 0
          const percent = total ? Math.round((present / total) * 100) : null

          const card = (
            <>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-mono text-sm font-medium text-card-foreground">{course.code}</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">{course.title}</p>
                </div>
                {liveByCourse.has(course.id) && <StatusChip tone="live">Live</StatusChip>}
              </div>

              <p className="stat mt-4">
                {percent === null ? '—' : `${percent}%`}
              </p>
              <p className="meta mt-1">
                {total ? `${present} of ${total} classes` : 'No classes held yet'}
              </p>
            </>
          )

          const liveSessionId = liveByCourse.get(course.id)
          return liveSessionId ? (
            <Link
              key={course.id}
              href={`/scan?session=${liveSessionId}`}
              className="rounded-lg border border-border bg-card p-6 transition-colors duration-150 hover:border-primary"
            >
              {card}
            </Link>
          ) : (
            <div key={course.id} className="rounded-lg border border-border bg-card p-6">
              {card}
            </div>
          )
        })}
      </div>
    </>
  )
}

async function FacultyHome({ email }: { email: string }) {
  const mine = await db
    .select({ id: courses.id, code: courses.code, title: courses.title })
    .from(courses)
    .where(eq(courses.facultyEmail, email))
    .orderBy(courses.code)

  if (!mine.length) {
    return (
      <>
        <div className="my-8">
          <h1 className="page-title">Your courses</h1>
        </div>
        <p className="text-muted-foreground">No courses are assigned to this account yet.</p>
      </>
    )
  }

  const ids = mine.map((c) => c.id)

  const [live, roster] = await Promise.all([
    db
      .select({ id: classSessions.id, courseId: classSessions.courseId })
      .from(classSessions)
      .where(and(inArray(classSessions.courseId, ids), isNull(classSessions.endedAt))),
    db
      .select({ courseId: enrollments.courseId, n: count() })
      .from(enrollments)
      .where(inArray(enrollments.courseId, ids))
      .groupBy(enrollments.courseId),
  ])

  const liveByCourse = new Set(live.map((s) => s.courseId))
  const rosterByCourse = new Map(roster.map((r) => [r.courseId, r.n]))

  return (
    <>
      <div className="my-8">
        <h1 className="page-title">Your courses</h1>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {mine.map((course) => (
          <Link
            key={course.id}
            href={`/courses/${course.id}/session`}
            className="rounded-lg border border-border bg-card p-6 transition-colors duration-150 hover:border-primary"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-mono text-sm font-medium text-card-foreground">{course.code}</p>
                <p className="mt-0.5 text-sm text-muted-foreground">{course.title}</p>
              </div>
              {liveByCourse.has(course.id) && <StatusChip tone="live">Live</StatusChip>}
            </div>
            <p className="meta-lg mt-4">{rosterByCourse.get(course.id) ?? 0} students enrolled</p>
          </Link>
        ))}
      </div>
    </>
  )
}
