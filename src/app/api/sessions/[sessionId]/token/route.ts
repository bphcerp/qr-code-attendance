import { errorResponse, HttpError } from '@/lib/guards'
import { clientIp } from '@/lib/request'
import {
  fetchSession,
  assertSessionOpen,
  fetchDisplayToken,
  assertTokenValid,
  finalizeRedemption,
} from '@/lib/displayToken'
import { currentCounter, deriveQrToken, deriveCode, nextRotationAt } from '@/lib/token'

export const dynamic = 'force-dynamic'

/**
 * The projector polls this. Access is by display token only -- including when
 * the lecturer runs the display from their own laptop, which differs from the
 * original plan's two-path design. Making the faculty cookie a second way in
 * meant either leaving those displays uncounted or minting a row for them
 * anyway, so there is one path: the control page issues a token and opens the
 * display with it. Faculty authentication still gates issuing that token, which
 * is where the real check belongs.
 */
export async function GET(req: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  try {
    const { sessionId } = await params
    const dt = new URL(req.url).searchParams.get('dt')
    if (!dt) throw new HttpError(403, 'display_token_missing')

    const ip = clientIp(req)

    // Both reads are independent, so fire them together -- this endpoint is
    // polled continuously by every open display for the whole lecture, so the
    // saved round trip matters here more than anywhere else in the app.
    // Validation stays sequential and in the original order (session first)
    // so a closed session still always short-circuits before a token's
    // validity is looked at or reported.
    const [sessionRow, tokenRow] = await Promise.all([
      fetchSession(sessionId),
      fetchDisplayToken(sessionId, dt),
    ])
    const session = assertSessionOpen(sessionRow)
    const validToken = assertTokenValid(tokenRow, ip)
    await finalizeRedemption(validToken, ip)

    const counter = currentCounter(session.startedAt, session.rotationSeconds)

    return Response.json(
      {
        token: deriveQrToken(session.secret, sessionId, counter),
        code: deriveCode(session.secret, sessionId, counter),
        nextRotationAt: nextRotationAt(session.startedAt, session.rotationSeconds).toISOString(),
        serverTime: new Date().toISOString(),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    return errorResponse(err)
  }
}
