import { count, eq } from 'drizzle-orm'
import { db } from '../src/db'
import {
  attendanceRecords,
  classSessions,
  courseRoster,
  courses,
  enrollments,
  users,
} from '../src/db/schema'
import { getCourseAttendanceReport } from '../src/lib/attendanceReport'

let passed = 0

function check(label: string, condition: boolean) {
  if (!condition) throw new Error(`FAIL: ${label}`)
  passed++
  console.log(`PASS: ${label}`)
}

async function main() {
  const stamp = Date.now()
  const professor = `report.prof.${stamp}@hyderabad.bits-pilani.ac.in`
  const attendee = `f${stamp}a@hyderabad.bits-pilani.ac.in`
  const absentee = `f${stamp}b@hyderabad.bits-pilani.ac.in`
  const stranger = `f${stamp}c@hyderabad.bits-pilani.ac.in`

  await db.insert(users).values([
    { email: professor, name: 'Report Test Professor', role: 'faculty' },
    { email: attendee, name: 'Attendee Student' },
    { email: absentee, name: 'Absentee Student' },
    { email: stranger, name: 'Stranger Student' },
  ])

  const [course] = await db
    .insert(courses)
    .values({ code: `REPORT ${stamp}`, title: 'Report Test', facultyEmail: professor })
    .returning({ id: courses.id })

  try {
    const [first, second, live] = await db
      .insert(classSessions)
      .values([
        { courseId: course.id, secret: 'first', startedAt: new Date('2026-08-01T04:00:00Z'), endedAt: new Date('2026-08-01T05:00:00Z') },
        { courseId: course.id, secret: 'second', startedAt: new Date('2026-08-08T04:00:00Z'), endedAt: new Date('2026-08-08T05:00:00Z') },
        { courseId: course.id, secret: 'live', startedAt: new Date('2026-08-15T04:00:00Z') },
      ])
      .returning({ id: classSessions.id })

    await db.insert(attendanceRecords).values([
      { sessionId: first.id, studentEmail: attendee, source: 'qr' },
      { sessionId: first.id, studentEmail: stranger, source: 'qr' },
      { sessionId: live.id, studentEmail: absentee, source: 'qr' },
    ])

    await db.insert(courseRoster).values([
      { courseId: course.id, studentId: `f${stamp}a`, studentName: 'Attendee Student' },
      { courseId: course.id, studentId: `f${stamp}b`, studentName: 'Absentee Student' },
    ])

    const report = await getCourseAttendanceReport(course.id)

    check(
      'only completed sessions become columns, oldest first',
      report.sessions.length === 2 &&
        report.sessions[0].id === first.id &&
        report.sessions[1].id === second.id,
    )

    const present = report.students.find((student) => student.studentId === `f${stamp}a`)
    check(
      'a student marked in one class of two reads present then absent',
      Boolean(present) &&
        present!.present === 1 &&
        present!.marks[0] !== null &&
        present!.marks[1] === null &&
        present!.email === attendee,
    )

    const missing = report.students.find((student) => student.studentId === `f${stamp}b`)
    check(
      'a roster student who never marked is absent in every column',
      Boolean(missing) && missing!.present === 0 && missing!.marks.every((mark) => mark === null),
    )

    const offRoster = report.students.find((student) => student.name === 'Stranger Student')
    check(
      'a mark from someone missing from the roster still appears, flagged',
      Boolean(offRoster) && offRoster!.onRoster === false && offRoster!.present === 1,
    )

    const [firstCount] = await db
      .select({ count: count() })
      .from(attendanceRecords)
      .where(eq(attendanceRecords.sessionId, first.id))
    check(
      'column totals match a direct count per session',
      report.presentBySession[0] === firstCount.count && report.presentBySession[1] === 0,
    )

    // The roster is what makes the grid; without one the enrolled accounts are.
    await db.delete(courseRoster).where(eq(courseRoster.courseId, course.id))
    await db.insert(enrollments).values([
      { courseId: course.id, studentEmail: attendee },
      { courseId: course.id, studentEmail: absentee },
    ])

    const fallback = await getCourseAttendanceReport(course.id)
    check(
      'with no uploaded roster the enrolled accounts are listed instead',
      fallback.students.length === 3 &&
        fallback.students.filter((student) => student.onRoster).length === 2 &&
        fallback.students.some((student) => student.email === absentee && student.present === 0),
    )
  } finally {
    await db.delete(courses).where(eq(courses.id, course.id))
    await db.delete(users).where(eq(users.email, professor))
    await db.delete(users).where(eq(users.email, attendee))
    await db.delete(users).where(eq(users.email, absentee))
    await db.delete(users).where(eq(users.email, stranger))
  }

  console.log(`${passed}/6 report checks passed`)
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
