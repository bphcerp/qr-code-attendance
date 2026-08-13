import { eq } from 'drizzle-orm'
import { db } from '../src/db'
import { users, courses, classSessions, displayTokens } from '../src/db/schema'
import { newSessionSecret } from '../src/lib/token'
import { issueDisplayToken, activeDisplayCount, revokeDisplayTokens } from '../src/lib/displayToken'
import { securityHash } from '../src/lib/security'

const BASE = process.env.BASE_URL ?? 'http://localhost:3001'
const FACULTY = 'prof.test@hyderabad.bits-pilani.ac.in'

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

async function get(url: string, ip: string) {
  const res = await fetch(url, { headers: { 'x-forwarded-for': ip } })
  const body = await res.json().catch(() => ({}))
  return { status: res.status, body }
}

async function main() {
  await db.insert(users).values({ email: FACULTY, name: 'Test Prof', role: 'faculty' }).onConflictDoNothing()

  const [course] = await db
    .insert(courses)
    .values({ code: 'CS F213', title: 'OOP', facultyEmail: FACULTY })
    .returning({ id: courses.id })

  const [session] = await db
    .insert(classSessions)
    .values({ courseId: course.id, secret: newSessionSecret(), declaredDisplayCount: 2 })
    .returning({ id: classSessions.id })

  const { token } = await issueDisplayToken(session.id, FACULTY)
  const url = (dt?: string) =>
    `${BASE}/api/sessions/${session.id}/token${dt ? `?dt=${encodeURIComponent(dt)}` : ''}`

  console.log('\nDisplay endpoint gating')
  check('no display token is rejected', (await get(url(), '10.0.0.1')).status === 403)
  check('bogus display token is rejected', (await get(url('not-a-real-token'), '10.0.0.1')).status === 403)

  const first = await get(url(token), '10.0.0.1')
  check('valid token returns 200', first.status === 200, JSON.stringify(first.body))
  check('response carries qr token of 10 chars', first.body.token?.length === 10, String(first.body.token))
  check('response carries code of 6 chars', first.body.code?.length === 6, String(first.body.code))
  check('response carries serverTime', Boolean(first.body.serverTime))
  check('response carries nextRotationAt', Boolean(first.body.nextRotationAt))

  console.log('\nIP pinning')
  const [pinned] = await db.select({ pinnedNetworkHash: displayTokens.pinnedNetworkHash }).from(displayTokens).where(eq(displayTokens.sessionId, session.id))
  const expectedNetworkHash = securityHash('network', '10.0.0.1')
  check(
    'first redemption pins a keyed network hash',
    pinned.pinnedNetworkHash === expectedNetworkHash,
    String(pinned.pinnedNetworkHash),
  )
  const other = await get(url(token), '203.0.113.9')
  check('same token from another IP is rejected', other.status === 403, JSON.stringify(other.body))
  check('rejection names the reason', other.body.error === 'display_token_wrong_device', String(other.body.error))
  check('original IP still works', (await get(url(token), '10.0.0.1')).status === 200)

  console.log('\nLiveness counting')
  check('one live display counted', (await activeDisplayCount(session.id)) === 1)
  const { token: second } = await issueDisplayToken(session.id, FACULTY)
  await get(url(second), '10.0.0.2')
  check('two live displays counted', (await activeDisplayCount(session.id)) === 2)

  console.log('\nRotation')
  const a = await get(url(token), '10.0.0.1')
  await new Promise((r) => setTimeout(r, 5500))
  const b = await get(url(token), '10.0.0.1')
  check('token changes across a rotation tick', a.body.token !== b.body.token, `${a.body.token} vs ${b.body.token}`)
  check('code changes across a rotation tick', a.body.code !== b.body.code, `${a.body.code} vs ${b.body.code}`)
  check('qr and code are independent', a.body.token.slice(0, 6) !== a.body.code)

  console.log('\nRevocation')
  await revokeDisplayTokens(session.id, FACULTY)
  const revoked = await get(url(token), '10.0.0.1')
  check('revoked token stops working', revoked.status === 403, JSON.stringify(revoked.body))
  check('revocation names the reason', revoked.body.error === 'display_token_revoked', String(revoked.body.error))
  check('revoked displays drop out of the live count', (await activeDisplayCount(session.id)) === 0)

  console.log(`\n${pass} passed, ${fail} failed\n`)
  process.exit(fail ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
