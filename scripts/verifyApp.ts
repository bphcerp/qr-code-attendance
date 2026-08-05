import { eq } from 'drizzle-orm'
import { encode } from 'next-auth/jwt'
import { db } from '../src/db'
import { users, courses, enrollments, classSessions } from '../src/db/schema'

// The Google OAuth client doesn't exist yet, so there is no way to reach a
// signed-in screen through a browser. The session cookie is just a JWT signed
// with AUTH_SECRET, so this mints one directly and drives the real routes over
// real HTTP -- same reasoning as the other two scripts, which is that both bugs
// found so far only showed up against a live server and a live database.
const BASE = process.env.BASE_URL ?? 'http://localhost:3001'
const COOKIE = 'authjs.session-token'

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

async function main() {
  await db.insert(users).values([
    { email: PROF, name: 'Prof Ada', role: 'faculty' },
    { email: OTHER_PROF, name: 'Prof Bob', role: 'faculty' },
    { email: STUDENT, name: 'Student Sam' },
  ])

  const [course] = await db
    .insert(courses)
    .values({ code: `CS F${stamp % 1000}`, title: 'Data Structures', facultyEmail: PROF })
    .returning({ id: courses.id })

  await db.insert(enrollments).values({ courseId: course.id, studentEmail: STUDENT })

  const profCookie = await cookieFor(PROF, 'faculty')
  const otherCookie = await cookieFor(OTHER_PROF, 'faculty')
  const studentCookie = await cookieFor(STUDENT, 'student')

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
    facultyHtml.includes(`CS F${stamp % 1000}`) && facultyHtml.includes('students enrolled'),
  )
  check('faculty home links to the session control page', facultyHtml.includes(`/courses/${course.id}/session`))

  console.log('\nAccess scoping')
  check(
    'faculty can open their own session page',
    (await get(`/courses/${course.id}/session`, profCookie)).status === 200,
  )
  check(
    "another faculty gets 404 on someone else's course",
    (await get(`/courses/${course.id}/session`, otherCookie)).status === 404,
  )
  check(
    'a student gets 404 on the session page',
    (await get(`/courses/${course.id}/session`, studentCookie)).status === 404,
  )

  console.log('\nStarting a session over HTTP')
  const started = await fetch(`${BASE}/api/courses/${course.id}/sessions`, {
    method: 'POST',
    headers: { cookie: profCookie, 'content-type': 'application/json' },
    body: JSON.stringify({ rotationSeconds: 5, declaredDisplayCount: 2 }),
  })
  const session = await started.json()
  check('faculty starts a session', started.status === 200 && Boolean(session.id))

  const secondStart = await fetch(`${BASE}/api/courses/${course.id}/sessions`, {
    method: 'POST',
    headers: { cookie: otherCookie, 'content-type': 'application/json' },
    body: JSON.stringify({}),
  })
  check('another faculty cannot start a session on that course', secondStart.status === 403)

  console.log('\nStats')
  const stats = await (await get(`/api/sessions/${session.id}/stats`, profCookie)).json()
  check('stats report the roster size', stats.roster === 1)
  check('stats report nobody marked yet', stats.marked === 0)
  check('stats carry the declared display count', stats.declaredDisplayCount === 2)
  check('no displays are live yet', stats.activeDisplays === 0)
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

  console.log('\nCleanup')
  await db.delete(classSessions).where(eq(classSessions.courseId, course.id))
  await db.delete(enrollments).where(eq(enrollments.courseId, course.id))
  await db.delete(courses).where(eq(courses.id, course.id))
  await db.delete(users).where(eq(users.email, PROF))
  await db.delete(users).where(eq(users.email, OTHER_PROF))
  await db.delete(users).where(eq(users.email, STUDENT))

  console.log(`\n${pass} passed, ${fail} failed\n`)
  process.exit(fail ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
