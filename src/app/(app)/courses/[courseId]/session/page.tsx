import { notFound, redirect } from 'next/navigation'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '@/db'
import { classSessions, courses, users } from '@/db/schema'
import { auth } from '@/lib/auth'
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

  const [me] = await db.select({ role: users.role }).from(users).where(eq(users.email, email))

  const [course] = await db
    .select({
      id: courses.id,
      code: courses.code,
      title: courses.title,
      facultyEmail: courses.facultyEmail,
    })
    .from(courses)
    .where(eq(courses.id, courseId))

  // 404 rather than 403 on someone else's course: a wrong answer here tells the
  // asker the course exists, which is the thing they were fishing for.
  if (!course) notFound()
  if (me?.role !== 'admin' && course.facultyEmail.toLowerCase() !== email) notFound()

  const [open] = await db
    .select({
      id: classSessions.id,
      startedAt: classSessions.startedAt,
      rotationSeconds: classSessions.rotationSeconds,
    })
    .from(classSessions)
    .where(and(eq(classSessions.courseId, courseId), isNull(classSessions.endedAt)))

  return (
    <SessionControl
      courseId={course.id}
      courseCode={course.code}
      courseTitle={course.title}
      openSession={open ? { ...open, startedAt: open.startedAt.toISOString() } : null}
    />
  )
}
