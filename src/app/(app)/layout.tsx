import { redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { enrollments } from '@/db/schema'
import { auth } from '@/lib/auth'
import { getCurrentUser } from '@/lib/currentUser'
import { syncRosterEnrollment } from '@/lib/syncRosterEnrollment'
import AppShell from '@/components/AppShell'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  const email = session?.user?.email?.toLowerCase()
  if (!email) redirect('/login')

  await syncRosterEnrollment(email)

  // The JWT carries a role too, but it was written at sign-in and goes stale
  // the moment an admin changes it -- same reason requireRole() re-reads.
  const [me, [enrolled]] = await Promise.all([
    getCurrentUser(email),
    db
      .select({ courseId: enrollments.courseId })
      .from(enrollments)
      .where(eq(enrollments.studentEmail, email))
      .limit(1),
  ])
  if (!me) redirect('/login')

  return (
    <AppShell name={me.name} enrolled={Boolean(enrolled)}>
      {children}
    </AppShell>
  )
}
