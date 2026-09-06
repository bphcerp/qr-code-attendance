import { cookies } from 'next/headers'
import { and, countDistinct, eq, ne } from 'drizzle-orm'
import { db } from '@/db'
import { enrollments, attendanceRecords, attendanceFlags, courseRoster } from '@/db/schema'
import { errorResponse, requireUser, HttpError } from '@/lib/guards'
import { isUniqueViolation } from '@/db/errors'
import { clientIp, userAgent } from '@/lib/request'
import { fetchSession, assertSessionOpen } from '@/lib/displayToken'
import { verifyToken } from '@/lib/token'
import {
  resolveDevice,
  registerDeviceTx,
  activeDeviceIdFor,
  serializeDeviceCookie,
  DEVICE_COOKIE,
} from '@/lib/device'
import { haversineMetres, OUTLIER_METRES, IMPRECISE_ACCURACY_METRES } from '@/lib/geo'
import { normalizeStudentId, studentIdFromEmail } from '@/lib/studentId'
import { finiteOrNull } from '@/lib/num'

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

    const session = assertSessionOpen(await fetchSession(body.sessionId))

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

    const [enrolled] = await db
      .select({ courseId: enrollments.courseId })
      .from(enrollments)
      .where(
        and(eq(enrollments.courseId, session.courseId), eq(enrollments.studentEmail, email)),
      )
    if (!enrolled) {
      // A professor's uploaded roster is keyed by student ID, while attendance
      // is keyed by the authenticated email. Matching the email local-part lets
      // first-time students attend without asking the professor to re-import them.
      const roster = await db
        .select({ studentId: courseRoster.studentId })
        .from(courseRoster)
        .where(eq(courseRoster.courseId, session.courseId))
      const matchesRoster = roster.some(
        (student) => normalizeStudentId(student.studentId) === studentIdFromEmail(email),
      )
      if (!matchesRoster) throw new HttpError(403, 'not_enrolled')
      await db
        .insert(enrollments)
        .values({ courseId: session.courseId, studentEmail: email })
        .onConflictDoNothing()
    }

    const jar = await cookies()
    const ua = userAgent(req)
    const ip = clientIp(req)

    // Untrusted coordinates: the client normally sends numbers, but a crafted
    // request sends a string or NaN, which becomes a 500 the moment it reaches
    // the double-precision columns. Coerce once, here, and use these below.
    const lat = finiteOrNull(body.lat)
    const lng = finiteOrNull(body.lng)
    const accuracy = finiteOrNull(body.accuracy)

    // The device binding and the attendance record commit together. The
    // registration used to happen before the insert, so a scan that failed after
    // it left the phone bound forever with nothing to show for it -- and with no
    // way to release the binding, that student could never mark again. One
    // transaction means a failed mark leaves no device behind.
    //
    // resolveDevice is read-only, so it runs outside the transaction. If it
    // decides a new device is needed but loses the race to a simultaneous
    // first-mark for the same student, the partial unique index rejects the
    // insert with 23505 -- the old plain insert turned that into a 500. Instead
    // we adopt the device that won (it is this same student's own) and retry the
    // insert once, which then hits the attendance unique index and returns the
    // correct 409 already_marked.
    const decision = await resolveDevice(email, jar.get(DEVICE_COOKIE)?.value)
    if (!decision.ok) throw new HttpError(403, 'device_mismatch')
    const recentlyRebound = decision.recentlyRebound

    let recordId: string
    let deviceId: string
    let justRegistered = false
    let needsRegistration = decision.needsRegistration
    let resolvedDeviceId = decision.deviceId

    for (let attempt = 0; ; attempt++) {
      try {
        const result = await db.transaction(async (tx) => {
          const id = needsRegistration
            ? await registerDeviceTx(tx, email, body.fingerprint!, ua)
            : resolvedDeviceId!
          const [row] = await tx
            .insert(attendanceRecords)
            .values({
              sessionId: session.id,
              studentEmail: email,
              source: verified.kind,
              deviceId: id,
              fingerprint: body.fingerprint,
              ip,
              userAgent: ua,
              lat,
              lng,
              accuracy,
            })
            .returning({ id: attendanceRecords.id })
          return { recordId: row.id, deviceId: id }
        })
        recordId = result.recordId
        deviceId = result.deviceId
        justRegistered = needsRegistration
        break
      } catch (err) {
        if (
          needsRegistration &&
          attempt === 0 &&
          isUniqueViolation(err, 'devices_one_active_per_user')
        ) {
          const existing = await activeDeviceIdFor(email)
          if (existing) {
            needsRegistration = false
            resolvedDeviceId = existing
            continue
          }
        }
        if (isUniqueViolation(err, 'attendance_one_per_student_per_session')) {
          throw new HttpError(409, 'already_marked')
        }
        throw err
      }
    }

    // Soft flags. Nothing below rejects the mark -- these exist so faculty have
    // something to look at, not to decide anything on their own.
    const flags: { kind: string; detail?: Record<string, unknown> }[] = []

    if (body.geoDenied) {
      flags.push({ kind: 'geo_denied' })
    } else if (lat != null && lng != null) {
      if (accuracy != null && accuracy > IMPRECISE_ACCURACY_METRES) {
        flags.push({ kind: 'geo_imprecise', detail: { accuracy } })
      }
      if (session.roomLat != null && session.roomLng != null) {
        const metres = haversineMetres(lat, lng, session.roomLat, session.roomLng)
        if (metres > OUTLIER_METRES) {
          flags.push({ kind: 'geo_outlier', detail: { metres: Math.round(metres) } })
        }
      }
    }

    if (verified.kind === 'code') flags.push({ kind: 'code_entry' })
    if (recentlyRebound) flags.push({ kind: 'device_recently_rebound' })

    // A student with no device row yet gets whatever handset is in front of
    // them, which is the one window where someone signed into a friend's
    // account can mark them. It cannot be blocked: an honest first-timer is
    // indistinguishable from that, and blocking would deny the whole cohort
    // its first lecture. So it is recorded instead, and closes by itself the
    // moment that student has marked once.
    if (justRegistered) flags.push({ kind: 'device_first_use' })

    // One phone marking two students is the proxy signature -- but UA + screen
    // + timezone identifies a phone *model*, so two classmates on the same
    // Redmi collide without doing anything wrong. Hence a flag carrying the
    // count, never a block. The cluster is only meaningful once the session
    // ends, so the number here is what it was at this moment, not a verdict.
    const [shared] = await db
      .select({ others: countDistinct(attendanceRecords.studentEmail) })
      .from(attendanceRecords)
      .where(
        and(
          eq(attendanceRecords.sessionId, session.id),
          eq(attendanceRecords.fingerprint, body.fingerprint),
          ne(attendanceRecords.studentEmail, email),
        ),
      )
    if (shared?.others) {
      flags.push({ kind: 'fingerprint_collision', detail: { otherStudentsSoFar: shared.others } })
    }

    if (flags.length) {
      await db.insert(attendanceFlags).values(flags.map((f) => ({ ...f, recordId })))
    }

    const res = Response.json({ ok: true, source: verified.kind })
    if (justRegistered) {
      jar.set(DEVICE_COOKIE, serializeDeviceCookie(deviceId), {
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
