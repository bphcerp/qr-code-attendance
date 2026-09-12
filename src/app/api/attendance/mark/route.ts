import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { enrollments, attendanceRecords, attendanceFlags, courseRoster } from '@/db/schema'
import { errorResponse, requireUser, HttpError } from '@/lib/guards'
import { isUniqueViolation } from '@/db/errors'
import { clientIp, userAgent } from '@/lib/request'
import { fetchSession, assertSessionOpen } from '@/lib/displayToken'
import { verifyToken } from '@/lib/token'
import { haversineMetres, OUTLIER_METRES, IMPRECISE_ACCURACY_METRES } from '@/lib/geo'
import { emailCore, emailCoreFromEmail } from '@/lib/studentId'
import { finiteOrNull } from '@/lib/num'

type Body = {
  sessionId?: string
  token?: string
  lat?: number
  lng?: number
  accuracy?: number
  geoDenied?: boolean
}

export async function POST(req: Request) {
  try {
    const email = await requireUser()
    const body = (await req.json().catch(() => ({}))) as Body

    if (!body.sessionId || !body.token) {
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
      // is keyed by the authenticated email. Matching on the eight-digit email
      // core (studentId.ts) lets first-time students attend without asking the
      // professor to re-import them -- and works whether the sheet held the ERP
      // id, the campus username, or the full email.
      const roster = await db
        .select({ studentId: courseRoster.studentId })
        .from(courseRoster)
        .where(eq(courseRoster.courseId, session.courseId))
      const key = emailCoreFromEmail(email)
      const matchesRoster = roster.some((student) => emailCore(student.studentId) === key)
      if (!matchesRoster) throw new HttpError(403, 'not_enrolled')
      await db
        .insert(enrollments)
        .values({ courseId: session.courseId, studentEmail: email })
        .onConflictDoNothing()
    }

    const ua = userAgent(req)
    const ip = clientIp(req)

    // Untrusted coordinates: the client normally sends numbers, but a crafted
    // request sends a string or NaN, which becomes a 500 the moment it reaches
    // the double-precision columns. Coerce once, here, and use these below.
    const lat = finiteOrNull(body.lat)
    const lng = finiteOrNull(body.lng)
    const accuracy = finiteOrNull(body.accuracy)

    // A token is valid for every enrolled student at once, so reuse is prevented
    // per-student rather than per-token: the partial unique index rejects a
    // second mark for the same student in the same session with 23505, which we
    // turn into the correct 409 already_marked.
    let recordId: string
    try {
      const [row] = await db
        .insert(attendanceRecords)
        .values({
          sessionId: session.id,
          studentEmail: email,
          source: verified.kind,
          ip,
          userAgent: ua,
          lat,
          lng,
          accuracy,
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

    if (flags.length) {
      await db.insert(attendanceFlags).values(flags.map((f) => ({ ...f, recordId })))
    }

    return Response.json({ ok: true, source: verified.kind })
  } catch (err) {
    return errorResponse(err)
  }
}
