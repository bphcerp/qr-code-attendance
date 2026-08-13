'use server'

import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { db } from '@/db'
import { courses } from '@/db/schema'
import { requireRole } from '@/lib/guards'

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

  const [created] = await db
    .insert(courses)
    .values({ code, title: name, facultyEmail: email })
    .returning({ id: courses.id })

  if (!created) return { error: 'Could not create the course. Try again.' }

  revalidatePath('/')
  redirect(`/courses/${created.id}/session`)
}
