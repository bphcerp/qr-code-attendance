import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { classSessions } from '@/db/schema'
import { errorResponse, requireCourseAccess, HttpError } from '@/lib/guards'
import { issueDisplayToken, revokeDisplayTokens } from '@/lib/displayToken'
import { enforceRateLimit } from '@/lib/rateLimit'
import { securityHash } from '@/lib/security'
import { requireUuid } from '@/lib/validation'

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
    const { sessionId: rawSessionId } = await params
    const sessionId = requireUuid(rawSessionId)
    const { email } = await requireCourseAccess(await courseIdFor(sessionId))
    await enforceRateLimit({
      scope: 'display_token_mutation',
      keyHash: securityHash('account', email),
      limit: 20,
      windowSeconds: 60,
    })
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
    const { sessionId: rawSessionId } = await params
    const sessionId = requireUuid(rawSessionId)
    const { email } = await requireCourseAccess(await courseIdFor(sessionId))
    await enforceRateLimit({
      scope: 'display_token_mutation',
      keyHash: securityHash('account', email),
      limit: 20,
      windowSeconds: 60,
    })
    await revokeDisplayTokens(sessionId, email)
    return Response.json({ ok: true })
  } catch (err) {
    return errorResponse(err)
  }
}
