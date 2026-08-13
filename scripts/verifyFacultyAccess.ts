import { and, eq } from 'drizzle-orm'
import { encode } from 'next-auth/jwt'
import { db } from '../src/db'
import { auditLog, courses, facultyInvites, users } from '../src/db/schema'
import { claimFacultyInvite } from '../src/lib/auth'

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

const stamp = Date.now()
const ADMIN = `admin.${stamp}@hyderabad.bits-pilani.ac.in`
const PROF = `prof.${stamp}@hyderabad.bits-pilani.ac.in`
const STUDENT = `stud.${stamp}@hyderabad.bits-pilani.ac.in`
const INVITED = `invited.${stamp}@hyderabad.bits-pilani.ac.in`
const INVITED_ADMIN = `inviteadmin.${stamp}@hyderabad.bits-pilani.ac.in`

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
  const asProf = await get('/admin/faculty', profCookie)
  check('faculty get 404, not 403', asProf.status === 404, `got ${asProf.status}`)
  const asStudent = await get('/admin/faculty', studentCookie)
  check('students get 404, not 403', asStudent.status === 404, `got ${asStudent.status}`)

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
  check('the newly-made professor can own a course', Boolean(course?.id))

  const invitedCookie = await cookieFor(INVITED, 'faculty')
  const invitedHome = await get('/', invitedCookie)
  check('their home page renders', invitedHome.status === 200, `got ${invitedHome.status}`)
  check('it shows the course they own', (await invitedHome.text()).includes('Invited Course'))

  console.log('\nCleanup')
  await db.delete(courses).where(eq(courses.id, course.id))
  await db.delete(auditLog).where(eq(auditLog.actorEmail, ADMIN))
  for (const email of [INVITED, INVITED_ADMIN]) {
    await db.delete(facultyInvites).where(eq(facultyInvites.email, email))
  }
  for (const email of [ADMIN, PROF, STUDENT, INVITED, INVITED_ADMIN]) {
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

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
