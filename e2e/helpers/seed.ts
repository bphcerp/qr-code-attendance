import './env'
import { eq } from 'drizzle-orm'
import { db } from '../../src/db'
import {
  users,
  courses,
  courseFaculty,
  enrollments,
  classSessions,
} from '../../src/db/schema'

// Test fixtures written straight to the database the dev server reads, mirroring
// scripts/verifyApp.ts. Each call is stamped unique so specs don't collide and
// cleanup is exact. There is no course-creation UI, so seeding here is the only
// way to stand up a faculty-owned course with a roster.
export type CourseFixture = {
  stamp: number
  code: string
  title: string
  courseId: string
  prof: string
  otherProf: string
  student: string
  student2: string
}

export async function seedCourse(): Promise<CourseFixture> {
  const stamp = Date.now()
  const prof = `prof.${stamp}@hyderabad.bits-pilani.ac.in`
  const otherProf = `other.${stamp}@hyderabad.bits-pilani.ac.in`
  const student = `stud.${stamp}@hyderabad.bits-pilani.ac.in`
  const student2 = `stud2.${stamp}@hyderabad.bits-pilani.ac.in`
  const code = `CS F${stamp % 1000}`
  const title = 'Data Structures'

  await db.insert(users).values([
    { email: prof, name: 'Prof Ada', role: 'faculty' },
    { email: otherProf, name: 'Prof Bob', role: 'faculty' },
    { email: student, name: 'Student Sam' },
    { email: student2, name: 'Student Sara' },
  ])

  const [course] = await db
    .insert(courses)
    .values({ code, title, facultyEmail: prof })
    .returning({ id: courses.id })

  await db
    .insert(courseFaculty)
    .values({ courseId: course.id, facultyEmail: prof, addedByEmail: prof })

  await db.insert(enrollments).values([
    { courseId: course.id, studentEmail: student },
    { courseId: course.id, studentEmail: student2 },
  ])

  return { stamp, code, title, courseId: course.id, prof, otherProf, student, student2 }
}

export async function cleanupCourse(f: CourseFixture) {
  await db.delete(classSessions).where(eq(classSessions.courseId, f.courseId))
  await db.delete(enrollments).where(eq(enrollments.courseId, f.courseId))
  await db.delete(courseFaculty).where(eq(courseFaculty.courseId, f.courseId))
  await db.delete(courses).where(eq(courses.id, f.courseId))
  for (const email of [f.prof, f.otherProf, f.student, f.student2]) {
    await db.delete(users).where(eq(users.email, email))
  }
}

// Reads the rotating-token inputs for a live session, so a mark can be posted
// exactly the way the scanner would (see e2e/student.spec.ts). Uses the same
// deriveQrToken/currentCounter path as scripts/verifyApp.ts.
export async function sessionSecret(sessionId: string) {
  const [row] = await db
    .select({ secret: classSessions.secret, startedAt: classSessions.startedAt })
    .from(classSessions)
    .where(eq(classSessions.id, sessionId))
  return row
}
