import { and, eq, isNull } from 'drizzle-orm'
import { db } from '@/db'
import { classSessions } from '@/db/schema'
import { errorResponse, requireCourseAccess, HttpError } from '@/lib/guards'
import { isUniqueViolation } from '@/db/errors'
import { newSessionSecret, isValidRotationSeconds } from '@/lib/token'
import { issueDisplayToken } from '@/lib/displayToken'
import { clampInt, finiteOrNull } from '@/lib/num'

export async function POST(req: Request, { params }: { params: Promise<{ courseId: string }> }) {
  try {
    const { courseId } = await params
    const { email } = await requireCourseAccess(courseId)

    const body = await req.json().catch(() => ({}))
    const rotationSeconds = Number(body.rotationSeconds) || 5
    if (!isValidRotationSeconds(rotationSeconds)) throw new HttpError(400, 'invalid_rotation_seconds')
    // Clamp to a sane integer range: an unbounded value like 1e12 overflows the
    // integer column and turns a session start into a 500. No lecture theatre
    // has more than a handful of projectors.
    const declaredDisplayCount = clampInt(Number(body.declaredDisplayCount) || 1, 1, 99)

    // One open session per course at a time. Two live sessions would each hand
    // out valid tokens for the same room, and a student marking against the
    // wrong one would look present in a class the lecturer isn't running. This
    // pre-check gives a clean error for the common case; the partial unique
    // index (class_sessions_one_open_per_course) is what actually holds when a
    // double-click or two co-instructors race past this read.
    const [open] = await db
      .select({ id: classSessions.id })
      .from(classSessions)
      .where(and(eq(classSessions.courseId, courseId), isNull(classSessions.endedAt)))
    if (open) throw new HttpError(409, 'session_already_open')

    let session: { id: string; startedAt: Date }
    try {
      ;[session] = await db
        .insert(classSessions)
        .values({
          courseId,
          secret: newSessionSecret(),
          rotationSeconds,
          declaredDisplayCount,
          // A non-numeric room coordinate would 500 on the double-precision column
          // the same way the student scan path did.
          roomLat: finiteOrNull(body.roomLat),
          roomLng: finiteOrNull(body.roomLng),
        })
        .returning({ id: classSessions.id, startedAt: classSessions.startedAt })
    } catch (err) {
      if (isUniqueViolation(err, 'class_sessions_one_open_per_course')) {
        throw new HttpError(409, 'session_already_open')
      }
      throw err
    }

    const display = await issueDisplayToken(session.id, email)

    return Response.json({ ...session, displayToken: display.token })
  } catch (err) {
    return errorResponse(err)
  }
}
