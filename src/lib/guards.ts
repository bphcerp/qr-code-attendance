import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { users, courses, courseFaculty } from '@/db/schema'
import { auth } from './auth'

export type Role = 'student' | 'faculty' | 'admin'

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code)
  }
}

export async function requireUser() {
  const session = await auth()
  const email = session?.user?.email?.toLowerCase()
  if (!email) throw new HttpError(401, 'unauthenticated')
  return email
}

// Reads the role from the database rather than the JWT. The token's copy is set
// at sign-in and goes stale the moment an admin changes someone's role -- which
// matters most in the direction nobody notices, where a demoted account keeps
// working until its token expires.
export async function requireRole(...allowed: Role[]) {
  const email = await requireUser()
  const [row] = await db.select({ role: users.role }).from(users).where(eq(users.email, email))
  if (!row || !allowed.includes(row.role)) throw new HttpError(403, 'forbidden')
  return { email, role: row.role }
}

export async function requireCourseAccess(courseId: string) {
  const { email, role } = await requireRole('faculty', 'admin')
  if (role === 'admin') return { email, role }

  const [course] = await db
    .select({ facultyEmail: courses.facultyEmail })
    .from(courses)
    .where(eq(courses.id, courseId))
  if (!course) throw new HttpError(404, 'not_found')

  // Ownership is still checked first so a course whose membership row was
  // somehow lost does not lock its own creator out.
  if (course.facultyEmail.toLowerCase() === email) return { email, role }
  if (!(await teachesCourse(courseId, email))) throw new HttpError(403, 'forbidden')
  return { email, role }
}

/** Co-teaching membership, separate from ownership. Owners are also rows here. */
export async function teachesCourse(courseId: string, email: string) {
  const [row] = await db
    .select({ courseId: courseFaculty.courseId })
    .from(courseFaculty)
    .where(and(eq(courseFaculty.courseId, courseId), eq(courseFaculty.facultyEmail, email)))
  return Boolean(row)
}

export function errorResponse(err: unknown) {
  if (err instanceof HttpError) {
    return Response.json({ error: err.code }, { status: err.status })
  }
  console.error(err)
  return Response.json({ error: 'internal_error' }, { status: 500 })
}
