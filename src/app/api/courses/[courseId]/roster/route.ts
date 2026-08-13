import { errorResponse, requireCourseAccess, HttpError } from '@/lib/guards'
import { normalizeStudentId } from '@/lib/studentId'
import { removeRosterStudent, replaceCourseRoster } from '@/lib/courseRoster'

type IncomingRow = { studentId?: unknown; studentName?: unknown }

export async function POST(req: Request, { params }: { params: Promise<{ courseId: string }> }) {
  try {
    const { courseId } = await params
    await requireCourseAccess(courseId)
    const body = (await req.json().catch(() => ({}))) as { rows?: IncomingRow[] }
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

export async function DELETE(req: Request, { params }: { params: Promise<{ courseId: string }> }) {
  try {
    const { courseId } = await params
    await requireCourseAccess(courseId)
    const body = (await req.json().catch(() => ({}))) as { studentId?: unknown }
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
