import { errorResponse, requireCourseAccess, HttpError } from '@/lib/guards'
import { normalizeStudentId } from '@/lib/studentId'
import { searchStudentDirectory } from '@/lib/studentDirectory'
import { addDirectoryStudent, removeRosterStudent, replaceCourseRoster } from '@/lib/courseRoster'
import { enforceRateLimit } from '@/lib/rateLimit'
import { securityHash } from '@/lib/security'
import { readJsonObject, requireUuid } from '@/lib/validation'

type IncomingRow = { studentId?: unknown; studentName?: unknown }

export async function GET(req: Request, { params }: { params: Promise<{ courseId: string }> }) {
  try {
    const { courseId: rawCourseId } = await params
    const courseId = requireUuid(rawCourseId)
    const { email } = await requireCourseAccess(courseId)
    await enforceRateLimit({
      scope: 'directory_search',
      keyHash: securityHash('account', email),
      limit: 120,
      windowSeconds: 60,
    })
    const query = new URL(req.url).searchParams.get('q') ?? ''
    const students = await searchStudentDirectory(courseId, query)

    return Response.json({ students })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ courseId: string }> }) {
  try {
    const { courseId: rawCourseId } = await params
    const courseId = requireUuid(rawCourseId)
    const { email } = await requireCourseAccess(courseId)
    await enforceRateLimit({
      scope: 'roster_mutation',
      keyHash: securityHash('account', email),
      limit: 20,
      windowSeconds: 60,
    })
    const body = (await readJsonObject(req, 1_500_000)) as { rows?: IncomingRow[] }
    if (!Array.isArray(body.rows) || body.rows.length === 0 || body.rows.length > 5000) {
      throw new HttpError(400, 'invalid_roster')
    }

    const seen = new Set<string>()
    const rows = body.rows.map((row) => {
      const studentId = typeof row.studentId === 'string' ? row.studentId.trim() : ''
      const studentName = typeof row.studentName === 'string' ? row.studentName.trim() : ''
      const key = normalizeStudentId(studentId)
      if (!studentId || !studentName || !key || studentId.length > 80 || studentName.length > 160) {
        throw new HttpError(400, 'invalid_roster')
      }
      if (seen.has(key)) throw new HttpError(400, 'duplicate_student_id')
      seen.add(key)
      return { studentId, studentName }
    })

    await replaceCourseRoster(courseId, rows)

    return Response.json({ ok: true, count: rows.length })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function PUT(req: Request, { params }: { params: Promise<{ courseId: string }> }) {
  try {
    const { courseId: rawCourseId } = await params
    const courseId = requireUuid(rawCourseId)
    const { email: actorEmail } = await requireCourseAccess(courseId)
    await enforceRateLimit({
      scope: 'roster_mutation',
      keyHash: securityHash('account', actorEmail),
      limit: 20,
      windowSeconds: 60,
    })
    const body = (await readJsonObject(req, 4096)) as { email?: unknown }
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    if (!email || email.length > 254) throw new HttpError(400, 'invalid_student')

    const row = await addDirectoryStudent(courseId, email)
    if (!row) throw new HttpError(404, 'student_not_found')

    return Response.json({ ok: true, student: row })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ courseId: string }> }) {
  try {
    const { courseId: rawCourseId } = await params
    const courseId = requireUuid(rawCourseId)
    const { email } = await requireCourseAccess(courseId)
    await enforceRateLimit({
      scope: 'roster_mutation',
      keyHash: securityHash('account', email),
      limit: 20,
      windowSeconds: 60,
    })
    const body = (await readJsonObject(req, 4096)) as { studentId?: unknown }
    const studentId = typeof body.studentId === 'string' ? normalizeStudentId(body.studentId) : ''
    if (!studentId || studentId.length > 80) throw new HttpError(400, 'invalid_student')

    if (!await removeRosterStudent(courseId, studentId)) {
      throw new HttpError(404, 'student_not_found')
    }

    return Response.json({ ok: true })
  } catch (err) {
    return errorResponse(err)
  }
}
