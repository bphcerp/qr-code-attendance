import Link from 'next/link'
import { redirect } from 'next/navigation'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { db } from '@/db'
import { classSessions, courses, enrollments } from '@/db/schema'
import { auth } from '@/lib/auth'
import Scanner from '@/components/Scanner'

export const dynamic = 'force-dynamic'

export default async function ScanPage({
  searchParams,
}: {
  searchParams: Promise<{ session?: string }>
}) {
  const signedIn = await auth()
  const email = signedIn?.user?.email?.toLowerCase()
  if (!email) redirect('/login')

  const { session: picked } = await searchParams

  const enrolled = await db
    .select({ courseId: enrollments.courseId })
    .from(enrollments)
    .where(eq(enrollments.studentEmail, email))

  const ids = enrolled.map((e) => e.courseId)

  // The QR payload is the bare token with no session in it, so the scanner has
  // to know which session it is posting to before the camera opens.
  const live = ids.length
    ? await db
        .select({
          id: classSessions.id,
          code: courses.code,
          title: courses.title,
        })
        .from(classSessions)
        .innerJoin(courses, eq(courses.id, classSessions.courseId))
        .where(and(inArray(classSessions.courseId, ids), isNull(classSessions.endedAt)))
        .orderBy(courses.code)
    : []

  if (!live.length) {
    return (
      <>
        <div className="my-8">
          <h1 className="page-title">Scan</h1>
        </div>
        <p className="text-muted-foreground">
          None of your classes is taking attendance right now.
        </p>
      </>
    )
  }

  const target = live.find((s) => s.id === picked) ?? (live.length === 1 ? live[0] : null)

  if (!target) {
    return (
      <>
        <div className="my-8">
          <h1 className="page-title">Which class?</h1>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {live.map((s) => (
            <Link
              key={s.id}
              href={`/scan?session=${s.id}`}
              className="rounded-lg border border-border bg-card p-5 hover:border-primary"
            >
              <p className="font-mono text-sm font-medium text-card-foreground">{s.code}</p>
              <p className="mt-0.5 text-sm text-muted-foreground">{s.title}</p>
            </Link>
          ))}
        </div>
      </>
    )
  }

  // Capped to a phone-width column. The camera preview is square, so letting it
  // fill a desktop content area would put a one-metre video on the screen.
  return (
    <div className="mx-auto max-w-md">
      <div className="my-8">
        <h1 className="page-title">{target.code}</h1>
        <p className="mt-1 text-muted-foreground">{target.title}</p>
      </div>
      <Scanner sessionId={target.id} courseCode={target.code} courseTitle={target.title} />
    </div>
  )
}
