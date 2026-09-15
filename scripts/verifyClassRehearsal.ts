import { readFileSync } from 'fs'
import { basename } from 'path'
import { and, eq } from 'drizzle-orm'
import { encode } from 'next-auth/jwt'
import { db } from '../src/db'
import { courses, courseRoster, enrollments, users } from '../src/db/schema'
import { recordSignIn } from '../src/lib/auth'
import { getCourseAttendanceReport } from '../src/lib/attendanceReport'
import { parseRosterFile } from '../src/lib/parseRosterFile'
import { emailCore, emailCoreFromEmail } from '../src/lib/studentId'

// A whole class, end to end, on real data -- the thing that failed on 12 Sep,
// when SW E112's roster enrolled nobody: students could not see the course and
// every scan came back "Not marked". The other verify scripts seed synthetic
// accounts; this one runs against a copy of production (scripts/importFromSupabase.ts
// into a fresh local database) and the real roster sheet, over real HTTP.
//
//   DATABASE_URL=<local copy> npx tsx --env-file=.env.local \
//     scripts/verifyClassRehearsal.ts <roster.xlsx> ["SW E112"]
//
// Needs the dev server on 3001 pointed at the same database. It starts and ends a
// real session and writes real marks, so it refuses anything but localhost.
const BASE = process.env.BASE_URL ?? 'http://localhost:3001'
const COOKIE = 'authjs.session-token'
const DOMAIN = 'hyderabad.bits-pilani.ac.in'

let pass = 0
let fail = 0
function check(label: string, ok: boolean, detail = '') {
  if (ok) pass++
  else fail++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` ${detail}`}`)
}

async function cookieFor(email: string, role: string) {
  const token = await encode({ token: { email, role, sub: email }, secret: process.env.AUTH_SECRET!, salt: COOKIE })
  return `${COOKIE}=${token}`
}

async function page(path: string, cookie: string) {
  const res = await fetch(`${BASE}${path}`, { redirect: 'manual', headers: { cookie } })
  return { status: res.status, html: await res.text() }
}

async function api(method: string, path: string, cookie: string | null, body?: unknown, ip?: string) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(ip ? { 'x-forwarded-for': ip } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  return { status: res.status, body: await res.json().catch(() => ({})) }
}

async function main() {
  const [file, code = 'SW E112'] = process.argv.slice(2)
  if (!file) throw new Error('usage: verifyClassRehearsal.ts <roster file> [course code]')
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? '')) {
    throw new Error('refusing: DATABASE_URL is not a local database -- this starts a session and writes marks')
  }

  const [course] = await db
    .select({ id: courses.id, owner: courses.facultyEmail })
    .from(courses)
    .where(eq(courses.code, code))
  if (!course) throw new Error(`no course ${code}`)
  const [owner] = await db.select({ role: users.role }).from(users).where(eq(users.email, course.owner))

  console.log(`\nThe sheet is the roster (${basename(file)} -> ${code})`)
  const sheet = await parseRosterFile(new File([readFileSync(file)], basename(file)))
  const roster = await db
    .select({ key: courseRoster.matchKey })
    .from(courseRoster)
    .where(eq(courseRoster.courseId, course.id))
  const rosterKeys = new Set(roster.map((r) => r.key))
  const missing = sheet.filter((row) => !rosterKeys.has(emailCore(row.studentId)))
  check(`all ${sheet.length} students on the sheet are on the roster`, missing.length === 0, missing.slice(0, 5).map((r) => r.studentId).join(', '))

  // Real students off the sheet: one whose account already exists (signed in
  // before), and one who has never signed in -- the 126 of 566 on SW E112.
  const studentAccounts = new Map(
    (await db.select({ email: users.email }).from(users).where(eq(users.role, 'student'))).map((u) => [
      emailCoreFromEmail(u.email),
      u.email,
    ]),
  )
  const allCores = new Set((await db.select({ email: users.email }).from(users)).map((u) => emailCoreFromEmail(u.email)))
  const returning = sheet.find((row) => studentAccounts.has(emailCore(row.studentId)))
  const firstTime = sheet.find((row) => !allCores.has(emailCore(row.studentId)))
  if (!returning || !firstTime) throw new Error('need one student with an account and one without')
  const returningEmail = studentAccounts.get(emailCore(returning.studentId))!
  const firstTimeEmail = `f${emailCore(firstTime.studentId)}@${DOMAIN}`
  // Letters only in the local part, so its core can never land on a roster row.
  const outsiderEmail = `rehearsal.outsider@${DOMAIN}`

  const prof = await cookieFor(course.owner, owner?.role ?? 'faculty')
  const returningCookie = await cookieFor(returningEmail, 'student')
  const firstTimeCookie = await cookieFor(firstTimeEmail, 'student')
  const outsiderCookie = await cookieFor(outsiderEmail, 'student')

  console.log(`\nThe instructor starts class (${course.owner})`)
  const started = await api('POST', `/api/courses/${course.id}/sessions`, prof, { rotationSeconds: 5 })
  check('session starts', started.status === 200, JSON.stringify(started.body))
  const sessionId: string = started.body.id
  const displayToken: string = started.body.displayToken
  const poll = (ip: string) =>
    api('GET', `/api/sessions/${sessionId}/token?dt=${encodeURIComponent(displayToken)}`, null, undefined, ip)

  console.log('\nThe projector (no device pin)')
  const podium = await poll('10.0.0.1')
  check('display link shows a QR on the podium PC', podium.status === 200 && podium.body.token?.length === 10, JSON.stringify(podium.body))
  const moved = await poll('203.0.113.9')
  check('the same link keeps working from a different IP', moved.status === 200, JSON.stringify(moved.body))

  console.log(`\nA student who has signed in before (${returningEmail})`)
  let home = await page('/', returningCookie)
  check('home lists the course', home.status === 200 && home.html.includes(code))
  let scan = await page('/scan', returningCookie)
  check('scan opens the camera for this class', scan.html.includes(`Camera preview for scanning ${code}`))
  let mark = await api('POST', '/api/attendance/mark', returningCookie, {
    sessionId,
    token: (await poll('10.0.0.1')).body.token,
    geoDenied: true,
  })
  check('scanning the QR marks them present', mark.status === 200 && mark.body.ok === true, JSON.stringify(mark.body))
  mark = await api('POST', '/api/attendance/mark', returningCookie, {
    sessionId,
    token: (await poll('10.0.0.1')).body.token,
  })
  check('a second scan says already marked', mark.status === 409 && mark.body.error === 'already_marked', JSON.stringify(mark.body))

  console.log(`\nA student signing in for the first time (${firstTimeEmail})`)
  // recordSignIn is what the Google signIn callback runs. Enrolment has to be in
  // place when it returns: the first page renders its layout sync in parallel
  // with the page's own read, so it cannot be relied on for the first visit.
  await recordSignIn(firstTimeEmail, firstTime.studentName)
  const [enrolled] = await db
    .select({ courseId: enrollments.courseId })
    .from(enrollments)
    .where(and(eq(enrollments.courseId, course.id), eq(enrollments.studentEmail, firstTimeEmail)))
  check('signing in enrolled them from the roster', Boolean(enrolled))
  home = await page('/', firstTimeCookie)
  check('home lists the course on the very first visit', home.status === 200 && home.html.includes(code))
  scan = await page('/scan', firstTimeCookie)
  check('scan opens the camera for this class', scan.html.includes(`Camera preview for scanning ${code}`))
  mark = await api('POST', '/api/attendance/mark', firstTimeCookie, {
    sessionId,
    token: (await poll('10.0.0.1')).body.code,
    geoDenied: true,
  })
  check('typing the 6-character code marks them present', mark.status === 200 && mark.body.source === 'code', JSON.stringify(mark.body))

  console.log(`\nSomeone not on the roster (${outsiderEmail})`)
  await recordSignIn(outsiderEmail, 'Rehearsal Outsider')
  home = await page('/', outsiderCookie)
  check('home does not list the course', home.status === 200 && !home.html.includes(code))
  mark = await api('POST', '/api/attendance/mark', outsiderCookie, {
    sessionId,
    token: (await poll('10.0.0.1')).body.token,
  })
  check('their scan is refused as not enrolled', mark.status === 403 && mark.body.error === 'not_enrolled', JSON.stringify(mark.body))

  console.log('\nThe instructor ends class')
  const stats = await api('GET', `/api/sessions/${sessionId}/stats`, prof)
  check('live count shows the two marks', stats.body.marked === 2, JSON.stringify({ marked: stats.body.marked, roster: stats.body.roster }))
  check('live roster is the whole sheet', stats.body.roster >= sheet.length, String(stats.body.roster))
  const ended = await api('POST', `/api/sessions/${sessionId}/end`, prof)
  check('session ends', ended.status === 200 && ended.body.ok === true, JSON.stringify(ended.body))

  const report = await getCourseAttendanceReport(course.id)
  const col = report.sessions.findIndex((s) => s.id === sessionId)
  const presentIn = (email: string) => report.students.find((s) => s.email === email)?.marks[col] != null
  check('report has this class as a column', col >= 0)
  check('report shows both students present', presentIn(returningEmail) && presentIn(firstTimeEmail))
  check('report column total is 2', report.presentBySession[col] === 2, String(report.presentBySession[col]))
  const reportPage = await page(`/courses/${course.id}/session`, prof)
  check('report page renders for the instructor', reportPage.status === 200 && reportPage.html.includes('Download CSV'))

  console.log(`\n${pass} passed, ${fail} failed\n`)
  process.exit(fail ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
