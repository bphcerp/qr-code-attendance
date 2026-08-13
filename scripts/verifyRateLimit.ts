import { eq } from 'drizzle-orm'
import { db } from '../src/db'
import { classSessions, courses, users } from '../src/db/schema'
import { issueDisplayToken } from '../src/lib/displayToken'
import { clearRateLimit } from '../src/lib/rateLimit'
import { securityHash } from '../src/lib/security'
import { newSessionSecret } from '../src/lib/token'

const BASE = process.env.BASE_URL ?? 'http://localhost:3011'
const stamp = Date.now()
const FACULTY = `rate.limit.${stamp}@hyderabad.bits-pilani.ac.in`
const IP = `198.51.100.${(stamp % 200) + 1}`

async function main() {
  await db.insert(users).values({ email: FACULTY, name: 'Rate Limit Test', role: 'faculty' })
  const [course] = await db
    .insert(courses)
    .values({ code: `RL ${stamp % 10000}`, title: 'Limiter Test', facultyEmail: FACULTY })
    .returning({ id: courses.id })
  const [session] = await db
    .insert(classSessions)
    .values({ courseId: course.id, secret: newSessionSecret() })
    .returning({ id: classSessions.id })
  const { token } = await issueDisplayToken(session.id, FACULTY)
  const url = `${BASE}/api/sessions/${session.id}/token?dt=${encodeURIComponent(token)}`

  try {
    for (let attempt = 1; attempt <= 60; attempt++) {
      const response = await fetch(url, { headers: { 'x-forwarded-for': IP } })
      if (response.status !== 200) throw new Error(`attempt ${attempt} returned ${response.status}`)
    }

    const limited = await fetch(url, { headers: { 'x-forwarded-for': IP } })
    const body = await limited.json()
    if (limited.status !== 429 || body.error !== 'rate_limited' || !limited.headers.get('retry-after')) {
      throw new Error(`expected 429 rate_limited with Retry-After, got ${limited.status} ${JSON.stringify(body)}`)
    }
    console.log('Display polling returns 429 rate_limited with Retry-After after 60 requests')
  } finally {
    await clearRateLimit('display_poll', securityHash('network', IP))
    await db.delete(classSessions).where(eq(classSessions.id, session.id))
    await db.delete(courses).where(eq(courses.id, course.id))
    await db.delete(users).where(eq(users.email, FACULTY))
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
