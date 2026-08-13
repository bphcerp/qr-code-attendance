'use server'

import { and, eq, isNull } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { db } from '@/db'
import { auditLog, facultyInvites, users } from '@/db/schema'
import { isAllowedEmail } from '@/lib/auth'
import { requireRole } from '@/lib/guards'

export type FacultyAccessState = {
  error?: string
  notice?: string
}

function readEmail(formData: FormData, key: string) {
  const value = formData.get(key)
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

/**
 * Grants course-creation rights to an address. Two paths, because most of the
 * addresses an admin types here have never signed in:
 *
 *   - the account exists  -> its role is changed immediately
 *   - it doesn't          -> an invite is recorded and claimed at first sign-in
 *
 * Both end at the same place. The split exists so that no privileged `users`
 * row is ever created for an unauthenticated address (see facultyInvites in
 * db/schema.ts).
 */
export async function grantFacultyAccess(
  _previousState: FacultyAccessState,
  formData: FormData,
): Promise<FacultyAccessState> {
  const { email: actor } = await requireRole('admin')
  const email = readEmail(formData, 'email')

  if (!email) return { error: 'Enter an email address.' }
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: 'That does not look like an email address.' }
  }

  // An address outside the sign-in allowlist can never claim its invite, so it
  // would sit in the table forever looking like it had been granted something.
  if (!isAllowedEmail(email)) {
    return {
      error: 'That address cannot sign in. Only allowed institute domains can be made faculty.',
    }
  }

  const [existing] = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.email, email))

  if (existing) {
    if (existing.role === 'admin') {
      return { notice: `${email} is an admin and can already add courses.` }
    }
    if (existing.role === 'faculty') {
      return { notice: `${email} can already add courses.` }
    }

    await db.update(users).set({ role: 'faculty' }).where(eq(users.email, email))
    await db.insert(auditLog).values({
      actorEmail: actor,
      action: 'role.change',
      subject: email,
      detail: { from: existing.role, to: 'faculty' },
    })

    revalidatePath('/admin/faculty')
    return { notice: `${email} can now add courses.` }
  }

  const [invited] = await db
    .insert(facultyInvites)
    .values({ email, invitedByEmail: actor })
    .onConflictDoNothing()
    .returning({ email: facultyInvites.email })

  if (!invited) return { notice: `${email} is already on the list.` }

  await db.insert(auditLog).values({
    actorEmail: actor,
    action: 'faculty_invite.create',
    subject: email,
  })

  revalidatePath('/admin/faculty')
  return { notice: `${email} becomes faculty the first time they sign in.` }
}

/**
 * Withdraws access, from either side of that split -- a faculty account goes
 * back to being a student, an unclaimed invite is deleted. Courses the account
 * already owns are left alone: deleting them would take their sessions and
 * attendance history with them, so they stay put and stop being reachable.
 */
export async function revokeFacultyAccess(
  _previousState: FacultyAccessState,
  formData: FormData,
): Promise<FacultyAccessState> {
  const { email: actor } = await requireRole('admin')
  const email = readEmail(formData, 'email')

  if (!email) return { error: 'Enter an email address.' }
  if (email === actor) return { error: 'You cannot remove your own access.' }

  const [existing] = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.email, email))

  if (existing?.role === 'admin') {
    return { error: `${email} is an admin. Admin rights have to be removed first.` }
  }

  if (existing?.role === 'faculty') {
    await db.update(users).set({ role: 'student' }).where(eq(users.email, email))
    await db.insert(auditLog).values({
      actorEmail: actor,
      action: 'role.change',
      subject: email,
      detail: { from: 'faculty', to: 'student' },
    })

    // A claimed invite would re-grant the role on their next sign-in and
    // silently undo this.
    await db.delete(facultyInvites).where(eq(facultyInvites.email, email))

    revalidatePath('/admin/faculty')
    return { notice: `${email} can no longer add courses.` }
  }

  const [cancelled] = await db
    .delete(facultyInvites)
    .where(and(eq(facultyInvites.email, email), isNull(facultyInvites.claimedAt)))
    .returning({ email: facultyInvites.email })

  if (!cancelled) return { error: `${email} does not have faculty access.` }

  await db.insert(auditLog).values({
    actorEmail: actor,
    action: 'faculty_invite.cancel',
    subject: email,
  })

  revalidatePath('/admin/faculty')
  return { notice: `Invite for ${email} cancelled.` }
}
