import { createHash, randomBytes } from 'crypto'
import { and, eq, gt, isNull, sql } from 'drizzle-orm'
import { db } from '@/db'
import { displayTokens, classSessions, auditLog } from '@/db/schema'
import { HttpError } from './guards'

// A display is considered live if it polled within this window. Three missed
// polls at the default 5s rotation -- long enough that one dropped request
// doesn't make a projector vanish from the count, short enough that unplugging
// one shows up while the lecturer is still standing there.
const LIVE_WINDOW_SECONDS = 15

const DEFAULT_TTL_HOURS = 4

function hash(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

export async function issueDisplayToken(sessionId: string, issuedByEmail: string) {
  const token = randomBytes(24).toString('base64url')
  const expiresAt = new Date(Date.now() + DEFAULT_TTL_HOURS * 3600 * 1000)

  await Promise.all([
    db.insert(displayTokens).values({
      sessionId,
      tokenHash: hash(token),
      issuedByEmail,
      expiresAt,
    }),
    db.insert(auditLog).values({
      actorEmail: issuedByEmail,
      action: 'display_token.issue',
      subject: sessionId,
    }),
  ])

  return { token, expiresAt }
}

export async function revokeDisplayTokens(sessionId: string, actorEmail: string) {
  await Promise.all([
    db
      .update(displayTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(displayTokens.sessionId, sessionId), isNull(displayTokens.revokedAt))),
    db.insert(auditLog).values({
      actorEmail,
      action: 'display_token.revoke',
      subject: sessionId,
    }),
  ])
}

type DisplayTokenRow = typeof displayTokens.$inferSelect

// Read-only lookup, split out from validation so the caller can run it
// concurrently with the session lookup -- this is the poll every open display
// hits continuously for the whole lecture, so the round trip matters here more
// than anywhere else in the app.
export async function fetchDisplayToken(sessionId: string, token: string) {
  const [row] = await db
    .select()
    .from(displayTokens)
    .where(and(eq(displayTokens.tokenHash, hash(token)), eq(displayTokens.sessionId, sessionId)))
  return row
}

// Checks are self-contained to the token row (expiresAt is the token's own TTL
// from issueDisplayToken, not derived from the session) so this never needs
// the session row -- callers still resolve session status first, though, so a
// closed session always short-circuits before a token's validity is ever
// reported. Don't reorder that: it's what keeps a caller from learning a
// session is still open by how a bad token fails, or vice versa.
export function assertTokenValid(row: DisplayTokenRow | undefined) {
  if (!row) throw new HttpError(403, 'display_token_invalid')
  if (row.revokedAt) throw new HttpError(403, 'display_token_revoked')
  if (row.expiresAt.getTime() < Date.now()) throw new HttpError(403, 'display_token_expired')
  return row
}

// A display link used to pin to the first IP that opened it. It no longer does:
// behind the DADU box's reverse proxy the podium PC's apparent address can
// change mid-lecture (IPv4/IPv6, DHCP, however the proxy fills x-forwarded-for),
// and a pin that trips then blanks the QR for the whole theatre. A leaked link
// is still bounded by its TTL, by revocation, and by the geo flags on each mark.
//
// The first poll is still recorded once in the audit log, keyed off lastPingAt
// being unset rather than off the old pin column.
export async function finalizeRedemption(row: DisplayTokenRow, ip: string | null) {
  await db
    .update(displayTokens)
    .set({ lastPingAt: new Date() })
    .where(eq(displayTokens.id, row.id))

  if (!row.lastPingAt) {
    await db.insert(auditLog).values({
      actorEmail: row.issuedByEmail,
      action: 'display_token.redeem',
      subject: row.sessionId,
      ip,
    })
  }
}

type SessionRow = {
  id: string
  courseId: string
  secret: string
  startedAt: Date
  endedAt: Date | null
  rotationSeconds: number
  roomLat: number | null
  roomLng: number | null
}

export async function fetchSession(sessionId: string) {
  const [session] = await db
    .select({
      id: classSessions.id,
      courseId: classSessions.courseId,
      secret: classSessions.secret,
      startedAt: classSessions.startedAt,
      endedAt: classSessions.endedAt,
      rotationSeconds: classSessions.rotationSeconds,
      roomLat: classSessions.roomLat,
      roomLng: classSessions.roomLng,
    })
    .from(classSessions)
    .where(eq(classSessions.id, sessionId))
  return session
}

export function assertSessionOpen(session: SessionRow | undefined) {
  if (!session) throw new HttpError(404, 'not_found')
  if (session.endedAt) throw new HttpError(409, 'session_closed')
  return session
}

// Counted from lastPingAt rather than from open connections: serverless
// instances share no memory, so there is no single process that knows how many
// displays exist. Same reason SU Connect keeps its rate-limit counter in
// Postgres instead of in the edge function.
export async function activeDisplayCount(sessionId: string) {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(displayTokens)
    .where(
      and(
        eq(displayTokens.sessionId, sessionId),
        isNull(displayTokens.revokedAt),
        gt(displayTokens.lastPingAt, sql`now() - make_interval(secs => ${LIVE_WINDOW_SECONDS})`),
      ),
    )
  return row?.count ?? 0
}
