import { redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { users } from '@/db/schema'
import { auth } from '@/lib/auth'
import AppShell from '@/components/AppShell'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  const email = session?.user?.email?.toLowerCase()
  if (!email) redirect('/login')

  // The JWT carries a role too, but it was written at sign-in and goes stale
  // the moment an admin changes it -- same reason requireRole() re-reads.
  const [me] = await db
    .select({ name: users.name, role: users.role })
    .from(users)
    .where(eq(users.email, email))
  if (!me) redirect('/login')

  return (
    <AppShell name={me.name} role={me.role}>
      {children}
    </AppShell>
  )
}
