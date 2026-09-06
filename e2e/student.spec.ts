import { test, expect } from '@playwright/test'
import { signInAs, cookieHeader } from './helpers/auth'
import { seedCourse, cleanupCourse, sessionSecret, type CourseFixture } from './helpers/seed'
import { currentCounter, deriveQrToken } from '../src/lib/token'

// Student-side deploy readiness against a database built from the single
// consolidated baseline migration: sign-in gating, the enrolled-course home, the
// scan page's empty and live states, and a real attendance mark that shows up
// once the class ends.
test.describe.configure({ mode: 'serial' })

let fx: CourseFixture

test.beforeAll(async () => {
  fx = await seedCourse()
})

test.afterAll(async () => {
  if (fx) await cleanupCourse(fx)
})

test('an unauthenticated visitor is sent to the login page', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('button', { name: /sign in with google/i })).toBeVisible()
})

test('student home lists the enrolled course', async ({ context, page }) => {
  await signInAs(context, fx.student, 'student')
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'Your courses' })).toBeVisible()
  await expect(page.getByText(fx.code)).toBeVisible()
  await expect(page.getByText('No classes held yet')).toBeVisible()
})

test('the scan page shows the empty state when nothing is live', async ({ context, page }) => {
  await signInAs(context, fx.student, 'student')
  await page.goto('/scan')
  await expect(page.getByText(/taking attendance right now/i)).toBeVisible()
})

test('a student can mark attendance in a live session and see it after it ends', async ({
  context,
  page,
  baseURL,
}) => {
  const profCookie = await cookieHeader(fx.prof, 'faculty')

  // Faculty starts the class.
  const started = await fetch(`${baseURL}/api/courses/${fx.courseId}/sessions`, {
    method: 'POST',
    headers: { cookie: profCookie, 'content-type': 'application/json' },
    body: JSON.stringify({ rotationSeconds: 5, declaredDisplayCount: 1 }),
  })
  expect(started.status).toBe(200)
  const session = await started.json()

  // Student home now advertises the live class; the scan page opens on it.
  await signInAs(context, fx.student, 'student')
  await page.goto('/')
  await expect(page.getByText(/taking attendance/i)).toBeVisible()
  await page.goto('/scan')
  await expect(page.getByText(fx.title)).toBeVisible()
  await expect(page.getByText(/taking attendance right now/i)).toHaveCount(0)

  // Mark the way the scanner would: a token derived from the live session's
  // rotating secret (same path as scripts/verifyApp.ts).
  const secretRow = await sessionSecret(session.id)
  const counter = currentCounter(secretRow.startedAt, 5)
  const token = deriveQrToken(secretRow.secret, session.id, counter)
  const studentCookie = await cookieHeader(fx.student, 'student')

  const mark = (cookie: string) =>
    fetch(`${baseURL}/api/attendance/mark`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, token, fingerprint: 'e2e-handset', geoDenied: true }),
    })

  const first = await mark(studentCookie)
  expect(first.status).toBe(200)

  // Second scan by the same student, keeping the device cookie the first issued,
  // is the duplicate case -> 409 already_marked.
  const deviceCookie = first.headers.get('set-cookie')?.split(';')[0] ?? ''
  const repeat = await mark(`${studentCookie}; ${deviceCookie}`)
  expect(repeat.status).toBe(409)

  // End the class; attendance percentages count finished sessions only.
  const ended = await fetch(`${baseURL}/api/sessions/${session.id}/end`, {
    method: 'POST',
    headers: { cookie: profCookie },
  })
  expect(ended.status).toBe(200)

  // The student's home now reflects the attended, finished class.
  await page.goto('/')
  const card = page.locator('a', { hasText: fx.code })
  await expect(card.getByText('100%')).toBeVisible()
  await expect(card.getByText('1 of 1 classes')).toBeVisible()
})
