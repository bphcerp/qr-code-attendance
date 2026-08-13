import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { users, courses } from '@/db/schema'
import { auth } from './auth'

export type Role = 'student' | 'faculty' | 'admin'

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    public retryAfter?: number,
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
  if (course.facultyEmail.toLowerCase() !== email) throw new HttpError(403, 'forbidden')
  return { email, role }
}

export function errorResponse(err: unknown) {
  if (err instanceof HttpError) {
    return Response.json(
      { error: err.code },
      {
        status: err.status,
        headers: err.retryAfter ? { 'Retry-After': String(err.retryAfter) } : undefined,
      },
    )
  }
  console.error(err)
  return Response.json({ error: 'internal_error' }, { status: 500 })
}
