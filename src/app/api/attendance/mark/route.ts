import { cookies } from 'next/headers'
import { and, countDistinct, eq, ne } from 'drizzle-orm'
import { db } from '@/db'
import { enrollments, attendanceRecords, attendanceFlags, courseRoster } from '@/db/schema'
import { errorResponse, requireUser, HttpError } from '@/lib/guards'
import { isUniqueViolation } from '@/db/errors'
import { loadOpenSession } from '@/lib/displayToken'
import { verifyToken } from '@/lib/token'
import { checkDevice, serializeDeviceCookie, DEVICE_COOKIE } from '@/lib/device'
import { haversineMetres, OUTLIER_METRES, IMPRECISE_ACCURACY_METRES } from '@/lib/geo'
import { normalizeStudentId, studentIdFromEmail } from '@/lib/studentId'
import { securityHash } from '@/lib/security'
import { enforceRateLimit } from '@/lib/rateLimit'
import { optionalFiniteNumber, readJsonObject, requireUuid } from '@/lib/validation'

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
    const body = (await readJsonObject(req, 4096)) as Body

    if (
      typeof body.sessionId !== 'string' ||
      typeof body.token !== 'string' ||
      typeof body.fingerprint !== 'string' ||
      !/^[0-9a-f]{32}$/i.test(body.fingerprint) ||
      !/^[0-9A-Z]{6}$|^[0-9A-Z]{10}$/i.test(body.token.trim()) ||
      (body.geoDenied != null && typeof body.geoDenied !== 'boolean')
    ) {
      throw new HttpError(400, 'bad_request')
    }
    const sessionId = requireUuid(body.sessionId)
    const lat = optionalFiniteNumber(body.lat, -90, 90)
    const lng = optionalFiniteNumber(body.lng, -180, 180)
    const accuracy = optionalFiniteNumber(body.accuracy, 0, 100_000)
    if ((lat == null) !== (lng == null)) throw new HttpError(400, 'bad_request')

    await enforceRateLimit({
      scope: 'attendance_mark',
      keyHash: securityHash('account', email),
      limit: 12,
      windowSeconds: 60,
    })

    // 1 + 2. session has to be open before its secret means anything
    const session = await loadOpenSession(sessionId)

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

    // 4. device binding, before the insert so a rejected device leaves no trace
    const jar = await cookies()
    const fingerprintHash = securityHash('device-fingerprint', body.fingerprint.toLowerCase())
    const device = await checkDevice(email, jar.get(DEVICE_COOKIE)?.value, fingerprintHash)
    if (!device.ok) throw new HttpError(403, 'device_mismatch')

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
          fingerprintHash,
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
    if (device.recentlyRebound) flags.push({ kind: 'device_recently_rebound' })

    // A student with no device row yet gets whatever handset is in front of
    // them, which is the one window where someone signed into a friend's
    // account can mark them. It cannot be blocked: an honest first-timer is
    // indistinguishable from that, and blocking would deny the whole cohort
    // its first lecture. So it is recorded instead, and closes by itself the
    // moment that student has marked once.
    if (device.justRegistered) flags.push({ kind: 'device_first_use' })

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
          eq(attendanceRecords.fingerprintHash, fingerprintHash),
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
