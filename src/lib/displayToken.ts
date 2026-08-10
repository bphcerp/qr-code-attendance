import { createHash, randomBytes } from 'crypto'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '@/db'
import { displayTokens, classSessions, auditLog } from '@/db/schema'
import { HttpError } from './guards'

const DEFAULT_TTL_HOURS = 4

function hash(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

export async function issueDisplayToken(sessionId: string, issuedByEmail: string) {
  const token = randomBytes(24).toString('base64url')
  const expiresAt = new Date(Date.now() + DEFAULT_TTL_HOURS * 3600 * 1000)

  await db.insert(displayTokens).values({
    sessionId,
    tokenHash: hash(token),
    issuedByEmail,
    expiresAt,
  })

  await db.insert(auditLog).values({
    actorEmail: issuedByEmail,
    action: 'display_token.issue',
    subject: sessionId,
  })

  return { token, expiresAt }
}

export async function revokeDisplayTokens(sessionId: string, actorEmail: string) {
  await db
    .update(displayTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(displayTokens.sessionId, sessionId), isNull(displayTokens.revokedAt)))

  await db.insert(auditLog).values({
    actorEmail,
    action: 'display_token.revoke',
    subject: sessionId,
  })
}

/**
 * Validates a display token and stamps its heartbeat in the same call, so the
 * poll that fetches a QR is also what keeps the display counted as live.
 *
 * The IP pin is set on first redemption rather than at issue time, because the
 * podium PC's address isn't known when the lecturer generates the link on their
 * laptop. That leaves one gap worth being honest about: whoever redeems first
 * wins. If a student somehow redeemed before the projector did, the projector
 * would fail loudly and the lecturer would notice immediately -- which is why
 * this returns a distinct error rather than silently reissuing.
 */
export async function redeemDisplayToken(sessionId: string, token: string, ip: string | null) {
  const [row] = await db
    .select()
    .from(displayTokens)
    .where(and(eq(displayTokens.tokenHash, hash(token)), eq(displayTokens.sessionId, sessionId)))

  if (!row) throw new HttpError(403, 'display_token_invalid')
  if (row.revokedAt) throw new HttpError(403, 'display_token_revoked')
  if (row.expiresAt.getTime() < Date.now()) throw new HttpError(403, 'display_token_expired')

  if (row.pinnedIp && row.pinnedIp !== ip) {
    throw new HttpError(403, 'display_token_wrong_device')
  }

  await db
    .update(displayTokens)
    .set({ lastPingAt: new Date(), ...(row.pinnedIp ? {} : { pinnedIp: ip }) })
    .where(eq(displayTokens.id, row.id))

  if (!row.pinnedIp) {
    await db.insert(auditLog).values({
      actorEmail: row.issuedByEmail,
      action: 'display_token.redeem',
      subject: sessionId,
      ip,
    })
  }

  return row
}

export async function loadOpenSession(sessionId: string) {
  const [session] = await db
    .select({
      id: classSessions.id,
      courseId: classSessions.courseId,
      secret: classSessions.secret,
      startedAt: classSessions.startedAt,
      endedAt: classSessions.endedAt,
      rotationSeconds: classSessions.rotationSeconds,
    })
    .from(classSessions)
    .where(eq(classSessions.id, sessionId))

  if (!session) throw new HttpError(404, 'not_found')
  if (session.endedAt) throw new HttpError(409, 'session_closed')
  return session
}
