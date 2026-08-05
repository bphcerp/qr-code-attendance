import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { classSessions } from '@/db/schema'
import { errorResponse, requireCourseAccess, HttpError } from '@/lib/guards'
import { issueDisplayToken, revokeDisplayTokens } from '@/lib/displayToken'

async function courseIdFor(sessionId: string) {
  const [row] = await db
    .select({ courseId: classSessions.courseId })
    .from(classSessions)
    .where(eq(classSessions.id, sessionId))
  if (!row) throw new HttpError(404, 'not_found')
  return row.courseId
}

export async function POST(_req: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  try {
    const { sessionId } = await params
    const { email } = await requireCourseAccess(await courseIdFor(sessionId))
    const { token, expiresAt } = await issueDisplayToken(sessionId, email)
    return Response.json({ token, expiresAt: expiresAt.toISOString() })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    const { sessionId } = await params
    const { email } = await requireCourseAccess(await courseIdFor(sessionId))
    await revokeDisplayTokens(sessionId, email)
    return Response.json({ ok: true })
  } catch (err) {
    return errorResponse(err)
  }
}
