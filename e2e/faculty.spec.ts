import { test, expect } from '@playwright/test'
import { signInAs, cookieHeader } from './helpers/auth'
import { seedCourse, cleanupCourse, type CourseFixture } from './helpers/seed'

// Faculty-side deploy readiness against a database built from the single
// consolidated baseline migration: the course they own shows up, the session
// control page is reachable to them and nobody else, and a started session
// projects a QR on the display screen.
test.describe.configure({ mode: 'serial' })

let fx: CourseFixture

test.beforeAll(async () => {
  fx = await seedCourse()
})

test.afterAll(async () => {
  if (fx) await cleanupCourse(fx)
})

test('faculty home lists their course and links to session control', async ({ context, page }) => {
  await signInAs(context, fx.prof, 'faculty')
  await page.goto('/')

  await expect(page.getByText(fx.code)).toBeVisible()
  await expect(page.getByText(/students in roster/i)).toBeVisible()
  await expect(page.locator(`a[href="/courses/${fx.courseId}/session"]`)).toBeVisible()
})

test('faculty can open their own session control page', async ({ context, page }) => {
  await signInAs(context, fx.prof, 'faculty')
  await page.goto(`/courses/${fx.courseId}/session`)

  await expect(page.getByRole('heading', { name: fx.code })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Start attendance' })).toBeVisible()
})

test("another faculty cannot open someone else's session page", async ({ context, page }) => {
  await signInAs(context, fx.otherProf, 'faculty')
  await page.goto(`/courses/${fx.courseId}/session`)

  await expect(page.getByText('Start attendance')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: /available/i })).toBeVisible()
})

test('a student cannot open the session control page', async ({ context, page }) => {
  await signInAs(context, fx.student, 'student')
  await page.goto(`/courses/${fx.courseId}/session`)

  await expect(page.getByText('Start attendance')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: /available/i })).toBeVisible()
})

test('starting a session projects a live QR on the display screen', async ({
  context,
  page,
  baseURL,
}) => {
  // Start a session as the owner over the real API (there is no headless way to
  // click through the rotating-QR control), then issue a projector token.
  const cookie = await cookieHeader(fx.prof, 'faculty')
  const started = await fetch(`${baseURL}/api/courses/${fx.courseId}/sessions`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ rotationSeconds: 5, declaredDisplayCount: 1 }),
  })
  expect(started.status).toBe(200)
  const session = await started.json()
  expect(session.id).toBeTruthy()

  const issued = await fetch(`${baseURL}/api/sessions/${session.id}/display-token`, {
    method: 'POST',
    headers: { cookie },
  })
  expect(issued.status).toBe(200)
  const { token } = await issued.json()
  expect(token).toBeTruthy()

  // The projector page renders the rotating QR as inline SVG once it has polled
  // the current token with the display link.
  await signInAs(context, fx.prof, 'faculty')
  await page.goto(`/display/${session.id}?dt=${token}`)
  await expect(page.locator('svg').first()).toBeVisible()

  // Owner sees live stats; a different faculty is refused.
  const stats = await fetch(`${baseURL}/api/sessions/${session.id}/stats`, { headers: { cookie } })
  expect(stats.status).toBe(200)
  expect((await stats.json()).roster).toBe(2)

  const otherCookie = await cookieHeader(fx.otherProf, 'faculty')
  const refused = await fetch(`${baseURL}/api/sessions/${session.id}/stats`, {
    headers: { cookie: otherCookie },
  })
  expect(refused.status).toBe(403)
})
