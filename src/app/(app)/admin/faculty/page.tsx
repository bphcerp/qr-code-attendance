import { notFound, redirect } from 'next/navigation'
import { count, eq, isNull } from 'drizzle-orm'
import { MailCheck, Users } from 'lucide-react'
import { db } from '@/db'
import { courses, facultyInvites, users } from '@/db/schema'
import { auth } from '@/lib/auth'
import { getCurrentUser } from '@/lib/currentUser'
import EmptyState from '@/components/EmptyState'
import StatusChip from '@/components/StatusChip'
import GrantFacultyForm, { RevokeAccessForm } from '@/components/FacultyAccess'

export const dynamic = 'force-dynamic'

const dateFormatter = new Intl.DateTimeFormat('en-IN', {
  dateStyle: 'medium',
  timeZone: 'Asia/Kolkata',
})

export default async function FacultyAccessPage() {
  const session = await auth()
  const email = session?.user?.email?.toLowerCase()
  if (!email) redirect('/login')

  const me = await getCurrentUser(email)

  // 404 rather than 403, for the same reason someone else's course page does:
  // a 403 confirms the screen is there to be found.
  if (me?.role !== 'admin') notFound()

  const [faculty, invited] = await Promise.all([
    db
      .select({ email: users.email, name: users.name, courses: count(courses.id) })
      .from(users)
      .leftJoin(courses, eq(courses.facultyEmail, users.email))
      .where(eq(users.role, 'faculty'))
      .groupBy(users.email, users.name)
      .orderBy(users.name),
    db
      .select({
        email: facultyInvites.email,
        invitedByEmail: facultyInvites.invitedByEmail,
        createdAt: facultyInvites.createdAt,
      })
      .from(facultyInvites)
      .where(isNull(facultyInvites.claimedAt))
      .orderBy(facultyInvites.createdAt),
  ])

  return (
    <div className="py-8">
      <div className="my-8">
        <h1 className="page-title">Faculty access</h1>
        <p className="mt-1 text-muted-foreground">
          Who can create courses and take attendance. Admins can already do both.
        </p>
      </div>

      <GrantFacultyForm />

      <section className="mb-6 overflow-hidden rounded-lg border border-border bg-card">
        <div className="border-b border-border p-4">
          <h2 className="font-bold text-card-foreground">Professors</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {faculty.length} {faculty.length === 1 ? 'account' : 'accounts'} with access.
          </p>
        </div>

        {faculty.length ? (
          <ul className="divide-y divide-border">
            {faculty.map((person) => (
              <li
                key={person.email}
                className="flex flex-wrap items-center justify-between gap-3 p-4"
              >
                <div className="min-w-0">
                  <p className="font-medium text-card-foreground">{person.name}</p>
                  <p className="mt-0.5 font-mono text-xs break-all text-muted-foreground">
                    {person.email}
                  </p>
                  <p className="meta mt-1">
                    {person.courses} {person.courses === 1 ? 'course' : 'courses'}
                  </p>
                </div>
                <RevokeAccessForm email={person.email} label="Remove access" />
              </li>
            ))}
          </ul>
        ) : (
          <div className="p-4">
            <EmptyState icon={Users} title="No professors yet">
              Add an institute address above to let someone create courses.
            </EmptyState>
          </div>
        )}
      </section>

      {invited.length > 0 && (
        <section className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="border-b border-border p-4">
            <h2 className="font-bold text-card-foreground">Waiting for first sign-in</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Access is granted the moment these addresses sign in with Google.
            </p>
          </div>

          <ul className="divide-y divide-border">
            {invited.map((invite) => (
              <li
                key={invite.email}
                className="flex flex-wrap items-center justify-between gap-3 p-4"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <MailCheck aria-hidden="true" className="size-4 text-muted-foreground" />
                    <p className="font-mono text-sm break-all text-card-foreground">
                      {invite.email}
                    </p>
                    <StatusChip tone="pending">Pending</StatusChip>
                  </div>
                  <p className="meta mt-1">
                    Added {dateFormatter.format(invite.createdAt)} by {invite.invitedByEmail}
                  </p>
                </div>
                <RevokeAccessForm email={invite.email} label="Cancel" />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
