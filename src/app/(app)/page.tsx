import Link from 'next/link'
import { redirect } from 'next/navigation'
import { and, count, eq, inArray, isNotNull, isNull } from 'drizzle-orm'
import { db } from '@/db'
import { attendanceRecords, classSessions, courseFaculty, courseRoster, courses, enrollments, users } from '@/db/schema'
import { auth } from '@/lib/auth'
import { getCurrentUser } from '@/lib/currentUser'
import { BookOpen, ClipboardList } from 'lucide-react'
import EmptyState from '@/components/EmptyState'
import StatusChip from '@/components/StatusChip'
import { Button } from '@/components/ui/button'
import AddCourseForm from '@/components/AddCourseForm'

export const dynamic = 'force-dynamic'

export default async function HomePage() {
  const session = await auth()
  const email = session?.user?.email?.toLowerCase()
  if (!email) redirect('/login')

  const me = await getCurrentUser(email)
  if (!me) redirect('/login')

  return me.role === 'student' ? (
    <StudentHome email={email} />
  ) : (
    <FacultyHome email={email} name={me.name} />
  )
}

async function StudentHome({ email }: { email: string }) {
  const enrolled = await db
    .select({
      id: courses.id,
      code: courses.code,
      title: courses.title,
      facultyName: users.name,
    })
    .from(enrollments)
    .innerJoin(courses, eq(courses.id, enrollments.courseId))
    .innerJoin(users, eq(users.email, courses.facultyEmail))
    .where(eq(enrollments.studentEmail, email))
    .orderBy(courses.code)

  if (!enrolled.length) {
    return (
      <>
        <div className="my-8">
          <h1 className="page-title">Your courses</h1>
        </div>
        <EmptyState icon={BookOpen} title="No courses yet">
          You aren&rsquo;t enrolled in anything yet. Your instructor imports the roster.
        </EmptyState>
      </>
    )
  }

  const ids = enrolled.map((c) => c.id)

  // Percentages count finished sessions only -- a class that is still running
  // would otherwise read as a miss for everyone who hasn't scanned yet.
  const [live, held, attended, instructors] = await Promise.all([
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
    db
      .select({ courseId: courseFaculty.courseId, name: users.name })
      .from(courseFaculty)
      .innerJoin(users, eq(users.email, courseFaculty.facultyEmail))
      .where(inArray(courseFaculty.courseId, ids))
      .orderBy(users.name),
  ])

  const liveByCourse = new Map(live.map((s) => [s.courseId, s.id]))
  const heldByCourse = new Map(held.map((r) => [r.courseId, r.n]))
  const attendedByCourse = new Map(attended.map((r) => [r.courseId, r.n]))
  const facultyByCourse = new Map<string, string[]>()
  for (const instructor of instructors) {
    const names = facultyByCourse.get(instructor.courseId) ?? []
    names.push(instructor.name)
    facultyByCourse.set(instructor.courseId, names)
  }

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

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
                  <p className="meta mt-2">
                    {(facultyByCourse.get(course.id)?.length ?? 0) > 1 ? 'Professors' : 'Professor'}{' '}
                    {facultyByCourse.get(course.id)?.join(', ') ?? course.facultyName}
                  </p>
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

          return (
            <Link
              key={course.id}
              href={`/courses/${course.id}`}
              className="rounded-lg border border-border bg-card p-5 transition-colors duration-150 hover:border-primary"
            >
              {card}
            </Link>
          )
        })}
      </div>
    </>
  )
}

async function FacultyHome({ email, name }: { email: string; name: string }) {
  const mine = await db
    .select({ id: courses.id, code: courses.code, title: courses.title })
    .from(courseFaculty)
    .innerJoin(courses, eq(courses.id, courseFaculty.courseId))
    .where(eq(courseFaculty.facultyEmail, email))
    .orderBy(courses.code)

  if (!mine.length) {
    return (
      <>
        <div className="my-8">
          <h1 className="page-title">Your courses</h1>
        </div>
        <AddCourseForm professorName={name} />
        <EmptyState icon={ClipboardList} title="No assigned courses">
          Add your first course above to start taking attendance.
        </EmptyState>
      </>
    )
  }

  const ids = mine.map((c) => c.id)

  const [live, rosterCounts, enrollmentCounts] = await Promise.all([
    db
      .select({ id: classSessions.id, courseId: classSessions.courseId })
      .from(classSessions)
      .where(and(inArray(classSessions.courseId, ids), isNull(classSessions.endedAt))),
    db
      .select({ courseId: courseRoster.courseId, n: count() })
      .from(courseRoster)
      .where(inArray(courseRoster.courseId, ids))
      .groupBy(courseRoster.courseId),
    db
      .select({ courseId: enrollments.courseId, n: count() })
      .from(enrollments)
      .where(inArray(enrollments.courseId, ids))
      .groupBy(enrollments.courseId),
  ])

  const liveByCourse = new Set(live.map((s) => s.courseId))
  const rosterByCourse = new Map(rosterCounts.map((row) => [row.courseId, row.n]))
  const enrollmentByCourse = new Map(enrollmentCounts.map((row) => [row.courseId, row.n]))

  return (
    <>
      <div className="my-8">
        <h1 className="page-title">Your courses</h1>
      </div>

      <AddCourseForm professorName={name} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {mine.map((course) => (
          <Link
            key={course.id}
            href={`/courses/${course.id}/session`}
            className="rounded-lg border border-border bg-card p-5 transition-colors duration-150 hover:border-primary"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-mono text-sm font-medium text-card-foreground">{course.code}</p>
                <p className="mt-0.5 text-sm text-muted-foreground">{course.title}</p>
                <p className="meta mt-2">Professor {name}</p>
              </div>
              {liveByCourse.has(course.id) && <StatusChip tone="live">Live</StatusChip>}
            </div>
            <p className="meta-lg mt-4">
              {rosterByCourse.get(course.id) ?? enrollmentByCourse.get(course.id) ?? 0} students in roster
            </p>
          </Link>
        ))}
      </div>
    </>
  )
}
