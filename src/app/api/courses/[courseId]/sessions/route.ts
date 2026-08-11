import { and, eq, isNull } from 'drizzle-orm'
import { db } from '@/db'
import { classSessions } from '@/db/schema'
import { errorResponse, requireCourseAccess, HttpError } from '@/lib/guards'
import { newSessionSecret, isValidRotationSeconds } from '@/lib/token'

export async function POST(req: Request, { params }: { params: Promise<{ courseId: string }> }) {
  try {
    const { courseId } = await params
    await requireCourseAccess(courseId)

    const body = await req.json().catch(() => ({}))
    const rotationSeconds = Number(body.rotationSeconds) || 5
    if (!isValidRotationSeconds(rotationSeconds)) throw new HttpError(400, 'invalid_rotation_seconds')
    const declaredDisplayCount = Number(body.declaredDisplayCount) || 1

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
        roomLat: body.roomLat ?? null,
        roomLng: body.roomLng ?? null,
      })
      .returning({ id: classSessions.id, startedAt: classSessions.startedAt })

    return Response.json(session)
  } catch (err) {
    return errorResponse(err)
  }
}
