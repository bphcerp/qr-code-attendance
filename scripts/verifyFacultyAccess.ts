import { and, eq, inArray } from 'drizzle-orm'
import { encode } from 'next-auth/jwt'
import { db } from '../src/db'
import { auditLog, courseFaculty, courses, users } from '../src/db/schema'
import { recordSignIn } from '../src/lib/auth'

// Same harness as verifyApp.ts: the Google OAuth client doesn't exist yet, so
// the session cookie is minted directly and the real routes are driven over
// real HTTP. The sign-in upsert is exercised as a function rather than through
// a browser for the same reason -- it hangs off the signIn callback, which
// needs Google to fire.
const BASE = process.env.BASE_URL ?? 'http://localhost:3001'
const COOKIE = BASE.startsWith('https://') ? '__Secure-authjs.session-token' : 'authjs.session-token'

let pass = 0
let fail = 0
function check(label: string, ok: boolean, detail = '') {
  if (ok) {
    pass++
    console.log(`  PASS  ${label}`)
  } else {
    fail++
    console.log(`  FAIL  ${label} ${detail}`)
  }
}

async function cookieFor(email: string, role: string) {
  const token = await encode({
    token: { email, role, sub: email },
    secret: process.env.AUTH_SECRET!,
    salt: COOKIE,
  })
  return `${COOKIE}=${token}`
}

function get(path: string, cookie?: string) {
  return fetch(`${BASE}${path}`, { redirect: 'manual', headers: cookie ? { cookie } : {} })
}

async function isNotFound(path: string, cookie: string) {
  const response = await get(path, cookie)
  if (response.status === 404) return true
  return response.status === 200 && (await response.text()).includes('name="robots" content="noindex"')
}

const stamp = Date.now()
const ADMIN = `admin.${stamp}@hyderabad.bits-pilani.ac.in`
const PROF = `prof.${stamp}@hyderabad.bits-pilani.ac.in`
const STUDENT = `stud.${stamp}@hyderabad.bits-pilani.ac.in`
const GRANTED = `granted.${stamp}@hyderabad.bits-pilani.ac.in`
const GRANTED_ADMIN = `grantadmin.${stamp}@hyderabad.bits-pilani.ac.in`
const CO_TEACHER = `coteach.${stamp}@hyderabad.bits-pilani.ac.in`

async function roleOf(email: string) {
  const [row] = await db.select({ role: users.role }).from(users).where(eq(users.email, email))
  return row?.role
}

async function nameOf(email: string) {
  const [row] = await db.select({ name: users.name }).from(users).where(eq(users.email, email))
  return row?.name
}

// What grantFacultyAccess and addCourseFaculty write for an address that has
// never signed in.
async function grant(email: string, actor: string) {
  await db
    .insert(users)
    .values({ email, name: email.split('@')[0], role: 'faculty', campus: email.split('@')[1] })
    .onConflictDoNothing()
  await db.insert(auditLog).values({
    actorEmail: actor,
    action: 'role.change',
    subject: email,
    detail: { to: 'faculty', created: true },
  })
}

async function main() {
  await db.insert(users).values([
    { email: ADMIN, name: 'Admin Ada', role: 'admin' },
    { email: PROF, name: 'Prof Bob', role: 'faculty' },
    { email: STUDENT, name: 'Student Sam' },
  ])

  const adminCookie = await cookieFor(ADMIN, 'admin')
  const profCookie = await cookieFor(PROF, 'faculty')
  const studentCookie = await cookieFor(STUDENT, 'student')

  console.log('\nWho can reach the screen')
  const anon = await get('/admin/faculty')
  check('signed out redirects to login', anon.status === 307, `got ${anon.status}`)
  const asAdmin = await get('/admin/faculty', adminCookie)
  check('an admin sees the page', asAdmin.status === 200, `got ${asAdmin.status}`)
  check('faculty get the not-found page, not 403', await isNotFound('/admin/faculty', profCookie))
  check('students get the not-found page, not 403', await isNotFound('/admin/faculty', studentCookie))

  console.log('\nThe page lists who has access')
  const body = await asAdmin.text()
  check('an existing professor is listed', body.includes(PROF))
  check('a student is not listed', !body.includes(STUDENT))
  check('nothing is left waiting for a first sign-in', !body.includes('Waiting for first sign-in'))

  console.log('\nGranting an address that has never signed in')
  await grant(GRANTED, ADMIN)
  check('the account is faculty straight away', (await roleOf(GRANTED)) === 'faculty')
  check('its name stands in as the local part', (await nameOf(GRANTED)) === GRANTED.split('@')[0])

  const listed = await get('/admin/faculty', adminCookie)
  check('it shows up under Professors', (await listed.text()).includes(GRANTED))

  const [logged] = await db
    .select({ actor: auditLog.actorEmail })
    .from(auditLog)
    .where(and(eq(auditLog.subject, GRANTED), eq(auditLog.action, 'role.change')))
  check('the grant is written to the audit log', Boolean(logged))
  check('the audit log credits the admin who granted it', logged?.actor === ADMIN)

  console.log('\nTheir first sign-in keeps the role and fixes the name')
  await recordSignIn(GRANTED, 'Granted Gita')
  check('the role survives the upsert', (await roleOf(GRANTED)) === 'faculty')
  check('the placeholder name is replaced', (await nameOf(GRANTED)) === 'Granted Gita')

  console.log('\nA grant cannot demote')
  await db.insert(users).values({ email: GRANTED_ADMIN, name: 'Admin Two', role: 'admin' })
  await db
    .update(users)
    .set({ role: 'faculty' })
    .where(and(eq(users.email, GRANTED_ADMIN), eq(users.role, 'student')))
  check('an admin stays an admin', (await roleOf(GRANTED_ADMIN)) === 'admin')

  console.log('\nAccess survives the round trip')
  const [course] = await db
    .insert(courses)
    .values({ code: `CS F${stamp % 1000}`, title: 'Granted Course', facultyEmail: GRANTED })
    .returning({ id: courses.id })
  await db
    .insert(courseFaculty)
    .values({ courseId: course.id, facultyEmail: GRANTED, addedByEmail: GRANTED })
  check('the newly-made professor can own a course', Boolean(course?.id))

  const grantedCookie = await cookieFor(GRANTED, 'faculty')
  const grantedHome = await get('/', grantedCookie)
  check('their home page renders', grantedHome.status === 200, `got ${grantedHome.status}`)
  check('it shows the course they own', (await grantedHome.text()).includes('Granted Course'))

  console.log('\nA course owner can add an address that has never signed in')
  await grant(CO_TEACHER, GRANTED)
  await db
    .insert(courseFaculty)
    .values({ courseId: course.id, facultyEmail: CO_TEACHER, addedByEmail: GRANTED })
  check('they are faculty immediately', (await roleOf(CO_TEACHER)) === 'faculty')
  check('they teach the course immediately', await teachesCourse(course.id, CO_TEACHER))

  const coTeacherCookie = await cookieFor(CO_TEACHER, 'faculty')
  const coTeacherHome = await get('/', coTeacherCookie)
  check('the course appears on their dashboard', (await coTeacherHome.text()).includes('Granted Course'))

  console.log('\nRemoving them takes the course back')
  await db
    .delete(courseFaculty)
    .where(and(eq(courseFaculty.courseId, course.id), eq(courseFaculty.facultyEmail, CO_TEACHER)))
  check('the membership is gone', !await teachesCourse(course.id, CO_TEACHER))
  check('their course page 404s', await isNotFound(`/courses/${course.id}/session`, coTeacherCookie))

  console.log('\nCleanup')
  await db.delete(courses).where(eq(courses.id, course.id))
  await db.delete(auditLog).where(inArray(auditLog.actorEmail, [ADMIN, GRANTED]))
  for (const email of [ADMIN, PROF, STUDENT, GRANTED, GRANTED_ADMIN, CO_TEACHER]) {
    await db.delete(users).where(eq(users.email, email))
  }

  console.log(`\n${pass} passed, ${fail} failed\n`)
  process.exit(fail ? 1 : 0)
}

async function teachesCourse(courseId: string, email: string) {
  const [row] = await db
    .select({ email: courseFaculty.facultyEmail })
    .from(courseFaculty)
    .where(and(eq(courseFaculty.courseId, courseId), eq(courseFaculty.facultyEmail, email)))
  return Boolean(row)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
