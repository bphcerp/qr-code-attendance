import { notFound, redirect } from 'next/navigation'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '@/db'
import { classSessions, courses } from '@/db/schema'
import { auth } from '@/lib/auth'
import { getCurrentUser } from '@/lib/currentUser'
import SessionControl from '@/components/SessionControl'

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
  const [me, [course], [open]] = await Promise.all([
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
  ])

  // 404 rather than 403 on someone else's course: a wrong answer here tells the
  // asker the course exists, which is the thing they were fishing for.
  if (!course) notFound()
  if (me?.role !== 'admin' && course.facultyEmail.toLowerCase() !== email) notFound()

  return (
    <SessionControl
      courseId={course.id}
      courseCode={course.code}
      courseTitle={course.title}
      openSession={open ? { ...open, startedAt: open.startedAt.toISOString() } : null}
    />
  )
}
