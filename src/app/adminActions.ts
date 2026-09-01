'use server'

import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { db } from '@/db'
import { auditLog, users } from '@/db/schema'
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

// Promotes a student who is already here. Scoped to role='student' so it can
// never demote an admin, and the audit entry is only written if the update
// actually moved something.
async function promoteToFaculty(email: string, actor: string, from: string) {
  const promoted = await db
    .update(users)
    .set({ role: 'faculty' })
    .where(and(eq(users.email, email), eq(users.role, 'student')))
    .returning({ email: users.email })

  if (promoted.length) {
    await db.insert(auditLog).values({
      actorEmail: actor,
      action: 'role.change',
      subject: email,
      detail: { from, to: 'faculty' },
    })
  }
}

// Grants course-creation rights to an address, whether or not it has ever
// signed in -- an address that has not gets its `users` row written here, with
// the local part of the email standing in as a name until Google supplies a
// real one at first sign-in. That row is privileged before anyone has
// authenticated as it, which is only tolerable because isAllowedEmail() below
// confines every grant to the institute domains.
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

  // An address outside the sign-in allowlist can never reach the app, so the
  // grant would be an account nobody can ever log into -- and, worse, a
  // faculty row for an address the institute does not control.
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

    await promoteToFaculty(email, actor, existing.role)

    revalidatePath('/admin/faculty')
    return { notice: `${email} can now add courses.` }
  }

  const [created] = await db
    .insert(users)
    .values({
      email,
      name: email.split('@')[0],
      role: 'faculty',
      campus: email.split('@')[1],
    })
    .onConflictDoNothing()
    .returning({ email: users.email })

  if (created) {
    await db.insert(auditLog).values({
      actorEmail: actor,
      action: 'role.change',
      subject: email,
      detail: { to: 'faculty', created: true },
    })
  } else {
    // The row appeared between the lookup above and this insert -- either the
    // address signed in as a student, or another admin granted it. Either way
    // the promotion is the same one the existing-account path runs.
    await promoteToFaculty(email, actor, 'student')
  }

  revalidatePath('/admin/faculty')
  return { notice: `${email} can now add courses.` }
}

// Withdraws access: the account goes back to being a student. Courses it
// already owns are left alone -- deleting them would take their sessions and
// attendance history with them, so they stay put and stop being reachable.
// The row itself stays too, even for an address that never signed in; an
// unprivileged users row is harmless and the audit log still points at it.
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

  if (existing?.role !== 'faculty') {
    return { error: `${email} does not have faculty access.` }
  }

  await db.update(users).set({ role: 'student' }).where(eq(users.email, email))
  await db.insert(auditLog).values({
    actorEmail: actor,
    action: 'role.change',
    subject: email,
    detail: { from: 'faculty', to: 'student' },
  })

  revalidatePath('/admin/faculty')
  return { notice: `${email} can no longer add courses.` }
}
