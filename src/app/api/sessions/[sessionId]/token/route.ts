import { errorResponse, HttpError } from '@/lib/guards'
import { clientIp } from '@/lib/request'
import { loadOpenSession, redeemDisplayToken } from '@/lib/displayToken'
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

    const session = await loadOpenSession(sessionId)
    await redeemDisplayToken(sessionId, dt, clientIp(req))

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
