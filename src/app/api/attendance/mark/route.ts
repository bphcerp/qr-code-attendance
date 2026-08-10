import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { enrollments, attendanceRecords } from '@/db/schema'
import { errorResponse, requireUser, HttpError } from '@/lib/guards'
import { isUniqueViolation } from '@/db/errors'
import { loadOpenSession } from '@/lib/displayToken'
import { verifyToken } from '@/lib/token'

type Body = {
  sessionId?: string
  token?: string
}

export async function POST(req: Request) {
  try {
    const email = await requireUser()
    const body = (await req.json().catch(() => ({}))) as Body

    if (!body.sessionId || !body.token) {
      throw new HttpError(400, 'bad_request')
    }

    // 1 + 2. session has to be open before its secret means anything
    const session = await loadOpenSession(body.sessionId)

    const verified = verifyToken(
      body.token,
      session.secret,
      session.id,
      session.startedAt,
      session.rotationSeconds,
    )
    if (!verified.ok) {
      throw new HttpError(400, verified.reason === 'expired' ? 'token_expired' : 'invalid_token')
    }

    // 3. enrolment
    const [enrolled] = await db
      .select({ courseId: enrollments.courseId })
      .from(enrollments)
      .where(
        and(eq(enrollments.courseId, session.courseId), eq(enrollments.studentEmail, email)),
      )
    if (!enrolled) throw new HttpError(403, 'not_enrolled')

    // 4. one mark per student per session -- the unique index is the
    // authority here rather than a preceding select, which would race under
    // 600 simultaneous scans
    try {
      await db.insert(attendanceRecords).values({
        sessionId: session.id,
        studentEmail: email,
        source: verified.kind,
      })
    } catch (err) {
      if (isUniqueViolation(err, 'attendance_one_per_student_per_session')) {
        throw new HttpError(409, 'already_marked')
      }
      throw err
    }

    return Response.json({ ok: true, source: verified.kind })
  } catch (err) {
    return errorResponse(err)
  }
}
