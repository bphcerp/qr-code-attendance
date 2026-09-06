'use server'

import { and, eq, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { db } from '@/db'
import { auditLog, courseFaculty, courseRoster, courses, enrollments, users } from '@/db/schema'
import { isAllowedEmail } from '@/lib/auth'
import { requireRole, teachesCourse } from '@/lib/guards'
import { releaseActiveDevice } from '@/lib/device'
import { normalizeStudentId, studentIdFromEmail } from '@/lib/studentId'

export type CreateCourseState = {
  error?: string
  fieldErrors?: {
    code?: string
    name?: string
  }
}

function readText(formData: FormData, key: string) {
  const value = formData.get(key)
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

export async function createCourse(
  _previousState: CreateCourseState,
  formData: FormData,
): Promise<CreateCourseState> {
  const { email } = await requireRole('faculty', 'admin')
  const code = readText(formData, 'code').toUpperCase()
  const name = readText(formData, 'name')
  const fieldErrors: NonNullable<CreateCourseState['fieldErrors']> = {}

  if (code.length < 2) fieldErrors.code = 'Enter a course code.'
  else if (code.length > 32) fieldErrors.code = 'Use 32 characters or fewer.'

  if (name.length < 2) fieldErrors.name = 'Enter a course name.'
  else if (name.length > 120) fieldErrors.name = 'Use 120 characters or fewer.'

  if (Object.keys(fieldErrors).length) return { fieldErrors }

  const [existing] = await db
    .select({ id: courses.id })
    .from(courses)
    .where(and(eq(courses.facultyEmail, email), eq(courses.code, code)))
    .limit(1)

  if (existing) {
    return { fieldErrors: { code: 'You already have a course with this code.' } }
  }

  const created = await db.transaction(async (tx) => {
    const [course] = await tx
      .insert(courses)
      .values({ code, title: name, facultyEmail: email })
      .returning({ id: courses.id })

    if (!course) return null

    await tx
      .insert(courseFaculty)
      .values({ courseId: course.id, facultyEmail: email, addedByEmail: email })

    return course
  })

  if (!created) return { error: 'Could not create the course. Try again.' }

  revalidatePath('/')
  redirect(`/courses/${created.id}/session`)
}

export type CourseFacultyState = {
  error?: string
  notice?: string
}

// Adding and removing co-instructors is the owner's call, not any
// co-instructor's -- otherwise the first person added can remove the person who
// added them. Admins can do it too, since they can already reach every course.
async function requireCourseOwner(courseId: string) {
  const { email, role } = await requireRole('faculty', 'admin')
  const [course] = await db
    .select({ facultyEmail: courses.facultyEmail })
    .from(courses)
    .where(eq(courses.id, courseId))

  // 404 rather than 403, matching the course page: a 403 confirms the course
  // exists, which is what the request was fishing for.
  if (!course) return null
  if (role !== 'admin' && course.facultyEmail.toLowerCase() !== email) return null
  return { email, ownerEmail: course.facultyEmail.toLowerCase() }
}

export async function addCourseFaculty(
  _previousState: CourseFacultyState,
  formData: FormData,
): Promise<CourseFacultyState> {
  const courseId = readText(formData, 'courseId')
  const email = readText(formData, 'email').toLowerCase()

  if (!isUuid(courseId)) return { error: 'That course does not exist.' }
  const actor = await requireCourseOwner(courseId)
  if (!actor) return { error: 'You cannot change who teaches this course.' }

  if (!email) return { error: 'Enter an email address.' }
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: 'That does not look like an email address.' }
  }

  // The same reasoning as the admin screen: a grant is only safe because it
  // cannot leave the institute domains.
  if (!isAllowedEmail(email)) {
    return {
      error: 'That address cannot sign in. Only allowed institute domains can be added.',
    }
  }

  const [existing] = await db
    .select({ email: users.email, name: users.name, role: users.role })
    .from(users)
    .where(eq(users.email, email))

  // An address that has not signed in gets its account here, so the membership
  // below has a users row to reference. The name is a placeholder until Google
  // supplies a real one.
  let person = existing
  if (!person) {
    const [created] = await db
      .insert(users)
      .values({
        email,
        name: email.split('@')[0],
        role: 'faculty',
        campus: email.split('@')[1],
      })
      .onConflictDoNothing()
      .returning({ email: users.email, name: users.name, role: users.role })

    if (created) {
      await db.insert(auditLog).values({
        actorEmail: actor.email,
        action: 'role.change',
        subject: email,
        detail: { to: 'faculty', created: true, via: 'course_faculty' },
      })
    }

    // A no-op insert means the address signed in while this was running, so
    // the transaction below promotes it like any other existing student.
    person = created ?? { email, name: email.split('@')[0], role: 'student' }
  }

  const added = await db.transaction(async (tx) => {
    if (person.role === 'student') {
      const promoted = await tx
        .update(users)
        .set({ role: 'faculty' })
        .where(and(eq(users.email, email), eq(users.role, 'student')))
        .returning({ email: users.email })

      if (promoted.length) {
        await tx.insert(auditLog).values({
          actorEmail: actor.email,
          action: 'role.change',
          subject: email,
          detail: { from: 'student', to: 'faculty', via: 'course_faculty' },
        })
      }
    }

    const [membership] = await tx
      .insert(courseFaculty)
      .values({ courseId, facultyEmail: email, addedByEmail: actor.email })
      .onConflictDoNothing()
      .returning({ facultyEmail: courseFaculty.facultyEmail })

    if (!membership) return false

    await tx.insert(auditLog).values({
      actorEmail: actor.email,
      action: 'course_faculty.add',
      subject: email,
      detail: { courseId },
    })
    return true
  })

  if (!added) return { notice: `${person.name} already teaches this course.` }

  revalidatePath(`/courses/${courseId}/session`)
  revalidatePath('/')
  return { notice: `${person.name} can now take attendance for this course.` }
}

export async function removeCourseFaculty(
  _previousState: CourseFacultyState,
  formData: FormData,
): Promise<CourseFacultyState> {
  const courseId = readText(formData, 'courseId')
  const email = readText(formData, 'email').toLowerCase()

  if (!isUuid(courseId)) return { error: 'That course does not exist.' }
  const actor = await requireCourseOwner(courseId)
  if (!actor) return { error: 'You cannot change who teaches this course.' }

  // The owner's own row is what the course falls back to, and removing it would
  // leave a course whose creator cannot open it.
  if (email === actor.ownerEmail) {
    return { error: 'The course owner cannot be removed.' }
  }

  const removed = await db.transaction(async (tx) => {
    const [membership] = await tx
      .delete(courseFaculty)
      .where(and(eq(courseFaculty.courseId, courseId), eq(courseFaculty.facultyEmail, email)))
      .returning({ facultyEmail: courseFaculty.facultyEmail })

    if (!membership) return false

    await tx.insert(auditLog).values({
      actorEmail: actor.email,
      action: 'course_faculty.remove',
      subject: email,
      detail: { courseId },
    })
    return true
  })

  if (!removed) return { error: `${email} does not teach this course.` }

  revalidatePath(`/courses/${courseId}/session`)
  revalidatePath('/')
  return { notice: `${email} no longer teaches this course.` }
}

export type DeviceReleaseState = {
  error?: string
  notice?: string
}

// Releasing a device is any instructor's call, not only the owner's -- the
// person running the class is the one who needs to unstick a student mid-lecture.
// Admins can do it too, since they can already reach every course. Returns null
// (a generic error, matching requireCourseOwner) rather than confirming the
// course exists to someone who cannot see it.
async function requireCourseTeacher(courseId: string) {
  const { email, role } = await requireRole('faculty', 'admin')
  if (role === 'admin') return { email, role }

  const [course] = await db
    .select({ facultyEmail: courses.facultyEmail })
    .from(courses)
    .where(eq(courses.id, courseId))
  if (!course) return null
  if (course.facultyEmail.toLowerCase() === email) return { email, role }
  if (await teachesCourse(courseId, email)) return { email, role }
  return null
}

// Resolves the typed email or student ID to a student connected to this course,
// so an instructor can only release devices for their own students. An email is
// accepted when the student is enrolled or on the uploaded roster; a bare ID is
// matched against the course's enrolled accounts.
async function resolveCourseStudent(courseId: string, input: string): Promise<string | null> {
  if (input.includes('@')) {
    const candidate = input.toLowerCase()

    const [enrolled] = await db
      .select({ email: enrollments.studentEmail })
      .from(enrollments)
      .where(and(eq(enrollments.courseId, courseId), eq(enrollments.studentEmail, candidate)))
    if (enrolled) return enrolled.email

    const id = studentIdFromEmail(candidate)
    const [onRoster] = await db
      .select({ studentId: courseRoster.studentId })
      .from(courseRoster)
      .where(
        and(
          eq(courseRoster.courseId, courseId),
          sql`lower(replace(${courseRoster.studentId}, ' ', '')) = ${id}`,
        ),
      )
    return onRoster ? candidate : null
  }

  const id = normalizeStudentId(input)
  if (!id) return null
  const enrolled = await db
    .select({ email: enrollments.studentEmail })
    .from(enrollments)
    .where(eq(enrollments.courseId, courseId))
  const match = enrolled.find((row) => studentIdFromEmail(row.email) === id)
  return match?.email ?? null
}

// Frees a student's device binding so they can register a new phone. This is the
// only path anywhere that releases a binding -- without it, a new phone, cleared
// browser data, or a single failed scan locked a student out permanently, and
// the only recovery was hand-written SQL against production mid-lecture.
export async function releaseStudentDevice(
  _previousState: DeviceReleaseState,
  formData: FormData,
): Promise<DeviceReleaseState> {
  const courseId = readText(formData, 'courseId')
  const student = readText(formData, 'student')

  if (!isUuid(courseId)) return { error: 'That course does not exist.' }
  const actor = await requireCourseTeacher(courseId)
  if (!actor) return { error: 'You cannot manage devices for this course.' }

  if (!student) return { error: 'Enter the student’s email or ID.' }

  const studentEmail = await resolveCourseStudent(courseId, student)
  if (!studentEmail) return { error: 'No student on this course matches that email or ID.' }

  const released = await releaseActiveDevice(studentEmail)
  if (!released) {
    return { notice: `${studentEmail} has no active device — they can register on their next mark.` }
  }

  await db.insert(auditLog).values({
    actorEmail: actor.email,
    action: 'device.release',
    subject: studentEmail,
    detail: { courseId },
  })

  revalidatePath(`/courses/${courseId}/session`)
  return { notice: `Released ${studentEmail}’s device. They can register a new one on their next mark.` }
}
