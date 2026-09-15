import { readFileSync } from 'fs'
import { resolve } from 'path'
import { and, count, eq } from 'drizzle-orm'
import { db } from '../src/db'
import { courses, enrollments, users } from '../src/db/schema'
import { parseRosterFile, type RosterRow } from '../src/lib/parseRosterFile'
import { replaceCourseRoster } from '../src/lib/courseRoster'
import { emailCore } from '../src/lib/studentId'

// The gate that would have caught the SWE E112 outage: every real-shaped roster
// fixture, driven through the actual parser and the actual enrolment path,
// against the real database. Run `npm run build:fixtures` first.
const FIXTURES = resolve(process.cwd(), 'test-fixtures')
let passed = 0

function check(label: string, condition: boolean) {
  if (!condition) throw new Error(`FAIL: ${label}`)
  passed++
  console.log(`PASS: ${label}`)
}

// parseRosterFile only touches .name/.text()/.arrayBuffer(), so a disk-backed
// stand-in for the browser File is enough to drive it.
function fixtureFile(name: string): File {
  const buf = readFileSync(resolve(FIXTURES, name))
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  return {
    name,
    async text() {
      return buf.toString()
    },
    async arrayBuffer() {
      return ab
    },
  } as unknown as File
}

async function main() {
  const stamp = Date.now()
  const prof = `rosterfile.prof.${stamp}@hyderabad.bits-pilani.ac.in`
  await db.insert(users).values({ email: prof, name: 'Roster File Prof', role: 'faculty' }).onConflictDoNothing()
  const [course] = await db
    .insert(courses)
    .values({ code: `RFILE ${stamp}`, title: 'Roster File Test', facultyEmail: prof })
    .returning({ id: courses.id })

  const seeded: string[] = []
  async function seedAccountFor(row: RosterRow) {
    const email = row.email ?? `f${emailCore(row.studentId)}@hyderabad.bits-pilani.ac.in`
    await db.insert(users).values({ email, name: row.studentName }).onConflictDoNothing()
    seeded.push(email)
    return email
  }
  async function enrolledCount(email: string) {
    const [row] = await db
      .select({ count: count() })
      .from(enrollments)
      .where(and(eq(enrollments.courseId, course.id), eq(enrollments.studentEmail, email)))
    return row.count
  }

  try {
    // 1. The real ERP shape.
    const erp = await parseRosterFile(fixtureFile('roster_erp.xlsx'))
    check(
      'ERP fixture parses: 5 rows, ERP id in the id column, salutation stripped',
      erp.length === 5 && erp[0].studentId.startsWith('411') && !erp[0].studentName.startsWith('.'),
    )
    const erpEmail = await seedAccountFor(erp[0])
    const erpResult = await replaceCourseRoster(course.id, erp)
    check(
      'ERP fixture enrols the one seeded account and reports the other four unmatched',
      erpResult.enrolled === 1 && erpResult.unmatched.length === 4 && (await enrolledCount(erpEmail)) === 1,
    )

    // 2. Campus-id-only must enrol nobody -- and say so.
    const campus = await parseRosterFile(fixtureFile('roster_campus_only.xlsx'))
    const campusResult = await replaceCourseRoster(course.id, campus)
    check(
      'campus-id-only fixture enrols nobody and reports every row unmatched',
      campus.length === 5 && campusResult.enrolled === 0 && campusResult.unmatched.length === 5,
    )

    // 3. Email column drives the match even past an unusable id column.
    const withEmail = await parseRosterFile(fixtureFile('roster_with_email.csv'))
    check('email fixture carries the email column', withEmail[0].email?.startsWith('f') === true)
    const emailAddr = await seedAccountFor(withEmail[0])
    const emailResult = await replaceCourseRoster(course.id, withEmail)
    check(
      'email fixture enrols via the email column despite a campus id column',
      emailResult.enrolled === 1 && (await enrolledCount(emailAddr)) === 1,
    )

    // 4. Messy but valid: trimmed ids, skipped blank row.
    const messy = await parseRosterFile(fixtureFile('roster_messy.csv'))
    check(
      'messy fixture trims whitespace and skips the blank row',
      messy.length === 3 && messy[0].studentId === messy[0].studentId.trim() && !messy[0].studentId.includes(' '),
    )

    // 5. A duplicate id is rejected outright.
    let threw = false
    try {
      await parseRosterFile({
        name: 'dupes.csv',
        async text() {
          return 'ID,Name\n41120260001,One\n41120260001,Two\n'
        },
        async arrayBuffer() {
          return new ArrayBuffer(0)
        },
      } as unknown as File)
    } catch {
      threw = true
    }
    check('a duplicate id in the sheet is rejected by the parser', threw)
  } finally {
    await db.delete(courses).where(eq(courses.id, course.id))
    await db.delete(users).where(eq(users.email, prof))
    for (const email of seeded) await db.delete(users).where(eq(users.email, email))
  }

  console.log(`${passed}/7 roster-file checks passed`)
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
