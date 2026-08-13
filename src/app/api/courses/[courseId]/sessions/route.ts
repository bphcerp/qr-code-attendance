import { and, eq, isNull } from 'drizzle-orm'
import { db } from '@/db'
import { classSessions } from '@/db/schema'
import { errorResponse, requireCourseAccess, HttpError } from '@/lib/guards'
import { newSessionSecret, isValidRotationSeconds } from '@/lib/token'
import { issueDisplayToken } from '@/lib/displayToken'
import { enforceRateLimit } from '@/lib/rateLimit'
import { securityHash } from '@/lib/security'
import { optionalFiniteNumber, readJsonObject, requireUuid } from '@/lib/validation'

export async function POST(req: Request, { params }: { params: Promise<{ courseId: string }> }) {
  try {
    const { courseId: rawCourseId } = await params
    const courseId = requireUuid(rawCourseId)
    const { email } = await requireCourseAccess(courseId)
    await enforceRateLimit({
      scope: 'session_mutation',
      keyHash: securityHash('account', email),
      limit: 20,
      windowSeconds: 60,
    })

    const body = await readJsonObject(req, 4096)
    const rotationSeconds = body.rotationSeconds == null ? 5 : Number(body.rotationSeconds)
    if (!isValidRotationSeconds(rotationSeconds)) throw new HttpError(400, 'invalid_rotation_seconds')
    const declaredDisplayCount = body.declaredDisplayCount == null ? 1 : Number(body.declaredDisplayCount)
    if (!Number.isInteger(declaredDisplayCount) || declaredDisplayCount < 1 || declaredDisplayCount > 20) {
      throw new HttpError(400, 'invalid_display_count')
    }
    const roomLat = optionalFiniteNumber(body.roomLat, -90, 90)
    const roomLng = optionalFiniteNumber(body.roomLng, -180, 180)
    if ((roomLat == null) !== (roomLng == null)) throw new HttpError(400, 'bad_request')

    // One open session per course at a time. Two live sessions would each hand
    // out valid tokens for the same room, and a student marking against the
    // wrong one would look present in a class the lecturer isn't running.
    const [open] = await db
      .select({ id: classSessions.id })
      .from(classSessions)
      .where(and(eq(classSessions.courseId, courseId), isNull(classSessions.endedAt)))
    if (open) throw new HttpError(409, 'session_already_open')

    const [session] = await db
      .insert(classSessions)
      .values({
        courseId,
        secret: newSessionSecret(),
        rotationSeconds,
        declaredDisplayCount,
        roomLat,
        roomLng,
      })
      .returning({ id: classSessions.id, startedAt: classSessions.startedAt })

    const display = await issueDisplayToken(session.id, email)

    return Response.json({ ...session, displayToken: display.token })
  } catch (err) {
    return errorResponse(err)
  }
}
