import { eq } from 'drizzle-orm'
import { encode } from 'next-auth/jwt'
import { db } from '../src/db'
import {
  users,
  courses,
  enrollments,
  classSessions,
  attendanceFlags,
  attendanceRecords,
} from '../src/db/schema'
import { currentCounter, deriveQrToken } from '../src/lib/token'

// The Google OAuth client doesn't exist yet, so there is no way to reach a
// signed-in screen through a browser. The session cookie is just a JWT signed
// with AUTH_SECRET, so this mints one directly and drives the real routes over
// real HTTP -- same reasoning as the other two scripts, which is that both bugs
// found so far only showed up against a live server and a live database.
const BASE = process.env.BASE_URL ?? 'http://localhost:3001'

// Auth.js prefixes the cookie name with __Secure- whenever the app considers
// the connection secure, which it decides from the request's own protocol --
// not from BASE_URL. Running this against the https production deploy with
// the plain name looks exactly like every check failing at once, because the
// server never sees a cookie it recognises and treats every request as signed
// out.
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
  return fetch(`${BASE}${path}`, {
    redirect: 'manual',
    headers: cookie ? { cookie } : {},
  })
}

const stamp = Date.now()
const PROF = `prof.${stamp}@hyderabad.bits-pilani.ac.in`
const OTHER_PROF = `other.${stamp}@hyderabad.bits-pilani.ac.in`
const STUDENT = `stud.${stamp}@hyderabad.bits-pilani.ac.in`
const STUDENT2 = `stud2.${stamp}@hyderabad.bits-pilani.ac.in`

async function main() {
  await db.insert(users).values([
    { email: PROF, name: 'Prof Ada', role: 'faculty' },
    { email: OTHER_PROF, name: 'Prof Bob', role: 'faculty' },
    { email: STUDENT, name: 'Student Sam' },
    { email: STUDENT2, name: 'Student Sara' },
  ])

  const [course] = await db
    .insert(courses)
    .values({ code: `CS F${stamp % 1000}`, title: 'Data Structures', facultyEmail: PROF })
    .returning({ id: courses.id })

  await db.insert(enrollments).values([
    { courseId: course.id, studentEmail: STUDENT },
    { courseId: course.id, studentEmail: STUDENT2 },
  ])

  const profCookie = await cookieFor(PROF, 'faculty')
  const otherCookie = await cookieFor(OTHER_PROF, 'faculty')
  const studentCookie = await cookieFor(STUDENT, 'student')
  const student2Cookie = await cookieFor(STUDENT2, 'student')

  console.log('\nUnauthenticated')
  check('login page renders', (await get('/login')).status === 200)
  const home = await get('/')
  check('home redirects to login', home.status === 307 && home.headers.get('location')!.endsWith('/login'))
  check('scan redirects to login', (await get('/scan')).status === 307)
  check(
    'stats endpoint is 401, not 404',
    (await get(`/api/sessions/${crypto.randomUUID()}/stats`)).status === 401,
  )

  console.log('\nSigned in')
  const studentHome = await get('/', studentCookie)
  const studentHtml = await studentHome.text()
  check('student home renders', studentHome.status === 200)
  check('student home lists the enrolled course', studentHtml.includes(`CS F${stamp % 1000}`))

  const idleScan = await get('/scan', studentCookie)
  check('scan says nothing is live', (await idleScan.text()).includes('taking attendance right now'))

  // React splits interpolated text into separate SSR nodes, so the roster count
  // and its label never appear as one contiguous string in the markup.
  const facultyHtml = await (await get('/', profCookie)).text()
  check(
    'faculty home lists their course',
    facultyHtml.includes(`CS F${stamp % 1000}`) && facultyHtml.includes('students in roster'),
  )
  check('faculty home links to the session control page', facultyHtml.includes(`/courses/${course.id}/session`))

  console.log('\nAccess scoping')
  check(
    'faculty can open their own session page',
    (await get(`/courses/${course.id}/session`, profCookie)).status === 200,
  )
  const otherFacultyPage = await get(`/courses/${course.id}/session`, otherCookie)
  const otherFacultyHtml = await otherFacultyPage.text()
  check(
    "another faculty cannot see someone else's course",
    !otherFacultyHtml.includes('Data Structures') && !otherFacultyHtml.includes('Student roster'),
    String(otherFacultyPage.status),
  )
  const studentFacultyPage = await get(`/courses/${course.id}/session`, studentCookie)
  const studentFacultyHtml = await studentFacultyPage.text()
  check(
    'a student cannot see the faculty session page',
    !studentFacultyHtml.includes('Data Structures') && !studentFacultyHtml.includes('Student roster'),
    String(studentFacultyPage.status),
  )

  console.log('\nMalformed input')
  const malformedUuid = await get('/api/sessions/not-a-uuid/token?dt=x')
  check('malformed session UUID is rejected', malformedUuid.status === 400, String(malformedUuid.status))
  const wrongType = await fetch(`${BASE}/api/courses/${course.id}/sessions`, {
    method: 'POST',
    headers: { cookie: profCookie, 'content-type': 'text/plain' },
    body: '{}',
  })
  check('non-JSON mutation payload is rejected', wrongType.status === 415, String(wrongType.status))
  const oversized = await fetch(`${BASE}/api/courses/${course.id}/sessions`, {
    method: 'POST',
    headers: { cookie: profCookie, 'content-type': 'application/json' },
    body: JSON.stringify({ padding: 'x'.repeat(5000) }),
  })
  check('oversized mutation payload is rejected', oversized.status === 413, String(oversized.status))
  const invalidCount = await fetch(`${BASE}/api/courses/${course.id}/sessions`, {
    method: 'POST',
    headers: { cookie: profCookie, 'content-type': 'application/json' },
    body: JSON.stringify({ declaredDisplayCount: 0 }),
  })
  check('invalid display count is rejected', invalidCount.status === 400, String(invalidCount.status))

  console.log('\nStarting a session over HTTP')
  const started = await fetch(`${BASE}/api/courses/${course.id}/sessions`, {
    method: 'POST',
    headers: { cookie: profCookie, 'content-type': 'application/json' },
    body: JSON.stringify({ rotationSeconds: 5, declaredDisplayCount: 2 }),
  })
  const session = await started.json()
  check('faculty starts a session', started.status === 200 && Boolean(session.id))
  check('new session includes its inline display token', Boolean(session.displayToken))

  const secondStart = await fetch(`${BASE}/api/courses/${course.id}/sessions`, {
    method: 'POST',
    headers: { cookie: otherCookie, 'content-type': 'application/json' },
    body: JSON.stringify({}),
  })
  check('another faculty cannot start a session on that course', secondStart.status === 403)

  console.log('\nStats')
  const stats = await (await get(`/api/sessions/${session.id}/stats`, profCookie)).json()
  check('stats report the roster size', stats.roster === 2)
  check('stats report nobody marked yet', stats.marked === 0)
  check('stats carry the declared display count', stats.declaredDisplayCount === 2)
  check('no displays are live yet', stats.activeDisplays === 0)
  check(
    'stats include every student in name order',
    stats.students?.length === 2 &&
      stats.students[0].name === 'Student Sam' &&
      stats.students[1].name === 'Student Sara',
  )
  check(
    'unmarked students have no timestamp or source',
    stats.students.every((student: { markedAt: string | null; source: string | null }) =>
      student.markedAt === null && student.source === null,
    ),
  )
  check(
    "another faculty is refused the stats",
    (await get(`/api/sessions/${session.id}/stats`, otherCookie)).status === 403,
  )
  check(
    'a student is refused the stats',
    (await get(`/api/sessions/${session.id}/stats`, studentCookie)).status === 403,
  )

  console.log('\nScan page with a live session')
  const liveScan = await get('/scan', studentCookie)
  const liveHtml = await liveScan.text()
  check('scan page opens on the live session', liveHtml.includes('Data Structures'))
  check('scan page is not the empty state', !liveHtml.includes('taking attendance right now'))

  const displayLink = await fetch(`${BASE}/api/sessions/${session.id}/display-token`, {
    method: 'POST',
    headers: { cookie: profCookie },
  })
  const issued = await displayLink.json()
  check('faculty issues a display token', displayLink.status === 200 && Boolean(issued.token))

  await fetch(`${BASE}/api/sessions/${session.id}/token?dt=${issued.token}`)
  const afterPoll = await (await get(`/api/sessions/${session.id}/stats`, profCookie)).json()
  check('one poll makes the display count as live', afterPoll.activeDisplays === 1)

  // Two students marking from one handset is the proxy signature. Neither is
  // rejected -- the same fingerprint is produced by two classmates owning the
  // same phone model, so this has to stay a flag -- but it must be recorded,
  // because the flags are the only thing that makes the attempt discoverable.
  console.log('\nProxy defences')
  const [secretRow] = await db
    .select({ secret: classSessions.secret, startedAt: classSessions.startedAt })
    .from(classSessions)
    .where(eq(classSessions.id, session.id))
  const counter = currentCounter(secretRow.startedAt, 5)
  const token = deriveQrToken(secretRow.secret, session.id, counter)

  const ONE_PHONE = '11111111111111111111111111111111'
  const mark = (cookie: string, fingerprint: string) =>
    fetch(`${BASE}/api/attendance/mark`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, token, fingerprint, geoDenied: true }),
    })

  const first = await mark(studentCookie, ONE_PHONE)
  check('a student with no device yet can mark', first.status === 200)

  const second = await mark(student2Cookie, ONE_PHONE)
  check('a second student on the same handset is not blocked', second.status === 200)

  // The browser keeps the device cookie the first mark issued. Without it the
  // repeat would be turned away by device binding before the duplicate check
  // ever runs, which passes for the wrong reason.
  const deviceCookie = first.headers.get('set-cookie')?.split(';')[0] ?? ''
  check('the first mark issues a device cookie', deviceCookie.startsWith('att_device='))

  const repeat = await mark(`${studentCookie}; ${deviceCookie}`, ONE_PHONE)
  check('the same student scanning twice is already_marked', repeat.status === 409)

  const strangerPhone = await mark(student2Cookie, '22222222222222222222222222222222')
  check('a student who already marked cannot mark again elsewhere', strangerPhone.status !== 200)

  const raised = await db
    .select({ kind: attendanceFlags.kind, student: attendanceRecords.studentEmail })
    .from(attendanceFlags)
    .innerJoin(attendanceRecords, eq(attendanceRecords.id, attendanceFlags.recordId))
    .where(eq(attendanceRecords.sessionId, session.id))

  const kinds = (email: string) => raised.filter((r) => r.student === email).map((r) => r.kind)
  check('a first-time device registration is flagged', kinds(STUDENT).includes('device_first_use'))
  check(
    'the shared handset raises a fingerprint collision',
    kinds(STUDENT2).includes('fingerprint_collision'),
  )
  check(
    'the first mark of a colliding pair is not retro-flagged',
    !kinds(STUDENT).includes('fingerprint_collision'),
  )

  const markedStats = await (await get(`/api/sessions/${session.id}/stats`, profCookie)).json()
  check(
    'student rows include their marked timestamps',
    markedStats.students.every((student: { markedAt: string | null }) =>
      Boolean(student.markedAt && !Number.isNaN(Date.parse(student.markedAt))),
    ),
  )
  check(
    'student rows include how attendance was marked',
    markedStats.students.every((student: { source: string | null }) => student.source === 'qr'),
  )

  console.log('\nCleanup')
  await db.delete(classSessions).where(eq(classSessions.courseId, course.id))
  await db.delete(enrollments).where(eq(enrollments.courseId, course.id))
  await db.delete(courses).where(eq(courses.id, course.id))
  for (const email of [PROF, OTHER_PROF, STUDENT, STUDENT2]) {
    await db.delete(users).where(eq(users.email, email))
  }

  console.log(`\n${pass} passed, ${fail} failed\n`)
  process.exit(fail ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
