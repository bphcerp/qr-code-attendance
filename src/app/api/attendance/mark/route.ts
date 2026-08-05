import { cookies } from 'next/headers'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { enrollments, attendanceRecords, attendanceFlags } from '@/db/schema'
import { errorResponse, requireUser, HttpError } from '@/lib/guards'
import { isUniqueViolation } from '@/db/errors'
import { clientIp, userAgent } from '@/lib/request'
import { loadOpenSession } from '@/lib/displayToken'
import { verifyToken } from '@/lib/token'
import { checkDevice, serializeDeviceCookie, DEVICE_COOKIE } from '@/lib/device'
import { haversineMetres, OUTLIER_METRES, IMPRECISE_ACCURACY_METRES } from '@/lib/geo'

type Body = {
  sessionId?: string
  token?: string
  fingerprint?: string
  lat?: number
  lng?: number
  accuracy?: number
  geoDenied?: boolean
}

export async function POST(req: Request) {
  try {
    const email = await requireUser()
    const body = (await req.json().catch(() => ({}))) as Body

    if (!body.sessionId || !body.token || !body.fingerprint) {
      throw new HttpError(400, 'bad_request')
    }

    // 1 + 2. session has to be open before its secret means anything
    const session = await loadOpenSession(body.sessionId)

    const verified = verifyToken(
      body.token,
      session.secret,
      session.id,
      session.startedAt,
      session.rotationSeconds,
    )
    if (!verified.ok) {
      throw new HttpError(400, verified.reason === 'expired' ? 'token_expired' : 'invalid_token')
    }

    // 3. enrolment
    const [enrolled] = await db
      .select({ courseId: enrollments.courseId })
      .from(enrollments)
      .where(
        and(eq(enrollments.courseId, session.courseId), eq(enrollments.studentEmail, email)),
      )
    if (!enrolled) throw new HttpError(403, 'not_enrolled')

    // 4. device binding, before the insert so a rejected device leaves no trace
    const jar = await cookies()
    const ua = userAgent(req)
    const device = await checkDevice(email, jar.get(DEVICE_COOKIE)?.value, body.fingerprint, ua)
    if (!device.ok) throw new HttpError(403, 'device_mismatch')

    const ip = clientIp(req)

    // 5. one mark per student per session -- the unique index is the authority
    // here rather than a preceding select, which would race under 600
    // simultaneous scans
    let recordId: string
    try {
      const [row] = await db
        .insert(attendanceRecords)
        .values({
          sessionId: session.id,
          studentEmail: email,
          source: verified.kind,
          deviceId: device.deviceId,
          fingerprint: body.fingerprint,
          ip,
          userAgent: ua,
          lat: body.lat ?? null,
          lng: body.lng ?? null,
          accuracy: body.accuracy ?? null,
        })
        .returning({ id: attendanceRecords.id })
      recordId = row.id
    } catch (err) {
      if (isUniqueViolation(err, 'attendance_one_per_student_per_session')) {
        throw new HttpError(409, 'already_marked')
      }
      throw err
    }

    // Soft flags. Nothing below rejects the mark -- these exist so faculty have
    // something to look at, not to decide anything on their own. Fingerprint
    // collisions are deliberately absent: whether a shared hash means two phones
    // or one common Android model depends on how large the cluster grows by the
    // end of the session, so it's computed when the roster is read, not here.
    const flags: { kind: string; detail?: Record<string, unknown> }[] = []

    if (body.geoDenied) {
      flags.push({ kind: 'geo_denied' })
    } else if (body.lat != null && body.lng != null) {
      if (body.accuracy != null && body.accuracy > IMPRECISE_ACCURACY_METRES) {
        flags.push({ kind: 'geo_imprecise', detail: { accuracy: body.accuracy } })
      }
      if (session.roomLat != null && session.roomLng != null) {
        const metres = haversineMetres(body.lat, body.lng, session.roomLat, session.roomLng)
        if (metres > OUTLIER_METRES) {
          flags.push({ kind: 'geo_outlier', detail: { metres: Math.round(metres) } })
        }
      }
    }

    if (verified.kind === 'code') flags.push({ kind: 'code_entry' })
    if (device.recentlyRebound) flags.push({ kind: 'device_recently_rebound' })

    if (flags.length) {
      await db.insert(attendanceFlags).values(flags.map((f) => ({ ...f, recordId })))
    }

    const res = Response.json({ ok: true, source: verified.kind })
    if (device.justRegistered) {
      jar.set(DEVICE_COOKIE, serializeDeviceCookie(device.deviceId), {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: 60 * 60 * 24 * 365,
      })
    }
    return res
  } catch (err) {
    return errorResponse(err)
  }
}
