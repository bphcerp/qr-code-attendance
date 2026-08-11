import { and, eq, inArray } from 'drizzle-orm'
import { db } from '@/db'
import { courseRoster, enrollments } from '@/db/schema'
import { errorResponse, requireCourseAccess, HttpError } from '@/lib/guards'
import { normalizeStudentId } from '@/lib/studentId'

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
      return { courseId, studentId, studentName }
    })

    await db.transaction(async (tx) => {
      const existing = await tx
        .select({ email: enrollments.studentEmail })
        .from(enrollments)
        .where(eq(enrollments.courseId, courseId))
      await tx.delete(courseRoster).where(eq(courseRoster.courseId, courseId))
      await tx.insert(courseRoster).values(rows)

      const currentIds = new Set(rows.map((row) => normalizeStudentId(row.studentId)))
      const staleEmails = existing
        .filter((row) => !currentIds.has(normalizeStudentId(row.email.split('@')[0] ?? '')))
        .map((row) => row.email)
      if (staleEmails.length) {
        await tx
          .delete(enrollments)
          .where(and(eq(enrollments.courseId, courseId), inArray(enrollments.studentEmail, staleEmails)))
      }
    })

    return Response.json({ ok: true, count: rows.length })
  } catch (err) {
    return errorResponse(err)
  }
}
