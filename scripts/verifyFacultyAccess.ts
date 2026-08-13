import { and, eq, inArray } from 'drizzle-orm'
import { encode } from 'next-auth/jwt'
import { db } from '../src/db'
import { auditLog, courseFaculty, courseFacultyInvites, courses, facultyInvites, users } from '../src/db/schema'
import { claimCourseFacultyInvites, claimFacultyInvite } from '../src/lib/auth'

// Same harness as verifyApp.ts: the Google OAuth client doesn't exist yet, so
// the session cookie is minted directly and the real routes are driven over
// real HTTP. The invite claim is exercised as a function rather than through a
// browser for the same reason -- it hangs off the signIn callback, which needs
// Google to fire.
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
const INVITED = `invited.${stamp}@hyderabad.bits-pilani.ac.in`
const INVITED_ADMIN = `inviteadmin.${stamp}@hyderabad.bits-pilani.ac.in`
const COURSE_INVITED = `courseinvite.${stamp}@hyderabad.bits-pilani.ac.in`
const CANCELLED = `cancelled.${stamp}@hyderabad.bits-pilani.ac.in`

async function roleOf(email: string) {
  const [row] = await db.select({ role: users.role }).from(users).where(eq(users.email, email))
  return row?.role
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

  console.log('\nAn invite becomes a role at first sign-in')
  await db.insert(facultyInvites).values({ email: INVITED, invitedByEmail: ADMIN })
  check('the invite starts unclaimed', (await pendingInvite(INVITED)) === true)

  // What the signIn callback does: the account is created as a student first,
  // then the invite is claimed.
  await db.insert(users).values({ email: INVITED, name: 'Invited Ivy' }).onConflictDoNothing()
  check('an invited address signs in as a student', (await roleOf(INVITED)) === 'student')

  await claimFacultyInvite(INVITED)
  check('claiming the invite grants faculty', (await roleOf(INVITED)) === 'faculty')
  check('the invite is marked claimed', (await pendingInvite(INVITED)) === false)

  const [logged] = await db
    .select({ action: auditLog.action, actor: auditLog.actorEmail })
    .from(auditLog)
    .where(and(eq(auditLog.subject, INVITED), eq(auditLog.action, 'role.change')))
  check('the promotion is written to the audit log', Boolean(logged))
  check('the audit log credits the admin who invited them', logged?.actor === ADMIN)

  await claimFacultyInvite(INVITED)
  check('claiming twice is a no-op', (await roleOf(INVITED)) === 'faculty')

  console.log('\nA re-issued invite cannot demote')
  await db.insert(users).values({ email: INVITED_ADMIN, name: 'Admin Two', role: 'admin' })
  await db.insert(facultyInvites).values({ email: INVITED_ADMIN, invitedByEmail: ADMIN })
  await claimFacultyInvite(INVITED_ADMIN)
  check('an admin stays an admin', (await roleOf(INVITED_ADMIN)) === 'admin')
  check('the invite is still consumed', (await pendingInvite(INVITED_ADMIN)) === false)

  console.log('\nAccess survives the round trip')
  const [course] = await db
    .insert(courses)
    .values({ code: `CS F${stamp % 1000}`, title: 'Invited Course', facultyEmail: INVITED })
    .returning({ id: courses.id })
  await db
    .insert(courseFaculty)
    .values({ courseId: course.id, facultyEmail: INVITED, addedByEmail: INVITED })
  check('the newly-made professor can own a course', Boolean(course?.id))

  const invitedCookie = await cookieFor(INVITED, 'faculty')
  const invitedHome = await get('/', invitedCookie)
  check('their home page renders', invitedHome.status === 200, `got ${invitedHome.status}`)
  check('it shows the course they own', (await invitedHome.text()).includes('Invited Course'))

  console.log('\nA course owner can invite before first sign-in')
  await db.transaction(async (tx) => {
    await tx.insert(courseFacultyInvites).values({
      courseId: course.id,
      email: COURSE_INVITED,
      invitedByEmail: INVITED,
    })
    await tx.insert(facultyInvites).values({ email: COURSE_INVITED, invitedByEmail: INVITED })
  })
  check('the course invite starts pending', await pendingCourseInvite(course.id, COURSE_INVITED))
  check('the faculty-role invite starts pending', (await pendingInvite(COURSE_INVITED)) === true)

  await db.insert(users).values({ email: COURSE_INVITED, name: 'Course Invitee' })
  await claimFacultyInvite(COURSE_INVITED)
  await claimCourseFacultyInvites(COURSE_INVITED)
  check('claiming grants the faculty role', (await roleOf(COURSE_INVITED)) === 'faculty')
  check('claiming adds the course membership', await teachesCourse(course.id, COURSE_INVITED))
  check('claiming removes the pending course invite', !await pendingCourseInvite(course.id, COURSE_INVITED))

  const courseInviteCookie = await cookieFor(COURSE_INVITED, 'faculty')
  const courseInviteHome = await get('/', courseInviteCookie)
  check('the invited course appears on their dashboard', (await courseInviteHome.text()).includes('Invited Course'))

  const [claimAudit] = await db
    .select({ actor: auditLog.actorEmail })
    .from(auditLog)
    .where(and(
      eq(auditLog.subject, COURSE_INVITED),
      eq(auditLog.action, 'course_faculty_invite.claim'),
    ))
  check('the course claim audit credits the owner', claimAudit?.actor === INVITED)

  console.log('\nA course invite can be cancelled before sign-in')
  await db.transaction(async (tx) => {
    await tx.insert(courseFacultyInvites).values({
      courseId: course.id,
      email: CANCELLED,
      invitedByEmail: INVITED,
    })
    await tx.insert(facultyInvites).values({ email: CANCELLED, invitedByEmail: INVITED })
  })
  await db
    .delete(courseFacultyInvites)
    .where(and(eq(courseFacultyInvites.courseId, course.id), eq(courseFacultyInvites.email, CANCELLED)))
  check('cancelling removes the course invite', !await pendingCourseInvite(course.id, CANCELLED))
  check('cancelling leaves the faculty-role invite for admins to control', (await pendingInvite(CANCELLED)) === true)

  console.log('\nCleanup')
  await db.delete(courses).where(eq(courses.id, course.id))
  await db.delete(auditLog).where(inArray(auditLog.actorEmail, [ADMIN, INVITED]))
  for (const email of [INVITED, INVITED_ADMIN, COURSE_INVITED, CANCELLED]) {
    await db.delete(facultyInvites).where(eq(facultyInvites.email, email))
  }
  for (const email of [ADMIN, PROF, STUDENT, INVITED, INVITED_ADMIN, COURSE_INVITED]) {
    await db.delete(users).where(eq(users.email, email))
  }

  console.log(`\n${pass} passed, ${fail} failed\n`)
  process.exit(fail ? 1 : 0)
}

async function pendingInvite(email: string) {
  const [row] = await db
    .select({ claimedAt: facultyInvites.claimedAt })
    .from(facultyInvites)
    .where(eq(facultyInvites.email, email))
  return row ? row.claimedAt === null : null
}

async function pendingCourseInvite(courseId: string, email: string) {
  const [row] = await db
    .select({ email: courseFacultyInvites.email })
    .from(courseFacultyInvites)
    .where(and(eq(courseFacultyInvites.courseId, courseId), eq(courseFacultyInvites.email, email)))
  return Boolean(row)
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
