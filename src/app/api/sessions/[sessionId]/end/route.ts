import { eq, and, isNull } from 'drizzle-orm'
import { db } from '@/db'
import { classSessions, displayTokens, auditLog } from '@/db/schema'
import { errorResponse, requireCourseAccess, HttpError } from '@/lib/guards'

export async function POST(_req: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  try {
    const { sessionId } = await params

    const [session] = await db
      .select({ courseId: classSessions.courseId, endedAt: classSessions.endedAt })
      .from(classSessions)
      .where(eq(classSessions.id, sessionId))
    if (!session) throw new HttpError(404, 'not_found')

    const { email } = await requireCourseAccess(session.courseId)
    if (session.endedAt) return Response.json({ ok: true, endedAt: session.endedAt })

    const endedAt = new Date()
    await db.update(classSessions).set({ endedAt }).where(eq(classSessions.id, sessionId))

    // Display tokens outliving their session would keep a projector rendering
    // codes for a class that has finished.
    await db
      .update(displayTokens)
      .set({ revokedAt: endedAt })
      .where(and(eq(displayTokens.sessionId, sessionId), isNull(displayTokens.revokedAt)))

    await db.insert(auditLog).values({
      actorEmail: email,
      action: 'session.end',
      subject: sessionId,
    })

    return Response.json({ ok: true, endedAt: endedAt.toISOString() })
  } catch (err) {
    return errorResponse(err)
  }
}
