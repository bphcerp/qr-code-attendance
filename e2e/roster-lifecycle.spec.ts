import { test, expect } from '@playwright/test'
import { resolve } from 'node:path'
import { readFile } from 'node:fs/promises'
import { eq } from 'drizzle-orm'
import { db } from '../src/db'
import { users, courses, courseFaculty, classSessions, enrollments, courseRoster } from '../src/db/schema'
import { signInAs, cookieHeader } from './helpers/auth'
import { sessionSecret } from './helpers/seed'
import { currentCounter, deriveQrToken } from '../src/lib/token'

// The full SWE E112 lifecycle on the real ERP export shape, in a real browser
// against the real database: a faculty uploads roster_erp.xlsx, the matching
// student account gets enrolled and can open the course, marks attendance, the
// mark shows in stats, and it lands on the student's home once the class ends.
// This is the exact path that failed live. Run `npm run build:fixtures` first.
test.describe.configure({ mode: 'serial' })

const ERP_FIXTURE = resolve(process.cwd(), 'test-fixtures', 'roster_erp.xlsx')
// roster_erp.xlsx first row: ERP 41120260001 -> core 20260001 -> this email.
const STUDENT = 'f20260001@hyderabad.bits-pilani.ac.in'
const ERP_ID = '41120260001'

let ctx: { courseId: string; prof: string; code: string }

test.beforeAll(async () => {
  const stamp = Date.now()
  const prof = `roster.prof.${stamp}@hyderabad.bits-pilani.ac.in`
  const code = `SWE E${stamp % 1000}`
  await db
    .insert(users)
    .values([
      { email: prof, name: 'Roster Prof', role: 'faculty' },
      { email: STUDENT, name: 'AAHI EXAMPLE' },
    ])
    .onConflictDoNothing()
  const [course] = await db
    .insert(courses)
    .values({ code, title: 'Software Engineering', facultyEmail: prof })
    .returning({ id: courses.id })
  await db.insert(courseFaculty).values({ courseId: course.id, facultyEmail: prof, addedByEmail: prof })
  ctx = { courseId: course.id, prof, code }
})

test.afterAll(async () => {
  if (!ctx) return
  await db.delete(classSessions).where(eq(classSessions.courseId, ctx.courseId))
  await db.delete(enrollments).where(eq(enrollments.courseId, ctx.courseId))
  await db.delete(courseRoster).where(eq(courseRoster.courseId, ctx.courseId))
  await db.delete(courseFaculty).where(eq(courseFaculty.courseId, ctx.courseId))
  await db.delete(courses).where(eq(courses.id, ctx.courseId))
  await db.delete(users).where(eq(users.email, ctx.prof))
  await db.delete(users).where(eq(users.email, STUDENT))
})

test('faculty uploads the ERP roster and the UI reports students enrolled', async ({ context, page }) => {
  await signInAs(context, ctx.prof, 'faculty')
  await page.goto(`/courses/${ctx.courseId}/session`)
  await expect(page.getByRole('heading', { name: 'Student roster' })).toBeVisible()

  // The upload input is visually hidden behind a button; set it directly.
  await page.setInputFiles('input[type=file]', ERP_FIXTURE)

  // The feedback reports enrolment, not just the imported row count -- the fix
  // for the silent failure. And the ERP id shows in the roster table, once
  // the collapsed list is opened.
  await expect(page.getByText(/enrolled/i)).toBeVisible()
  await page.getByText('Students in roster').click()
  await expect(page.getByText(ERP_ID)).toBeVisible()
})

test('the matching student account can now open the course', async ({ context, page }) => {
  await signInAs(context, STUDENT, 'student')
  await page.goto('/')
  await expect(page.getByText(ctx.code)).toBeVisible()

  await page.goto(`/courses/${ctx.courseId}`)
  await expect(page.getByRole('heading', { name: ctx.code })).toBeVisible()
})

test('the student marks attendance, it shows in stats, and lands on their home after the class ends', async ({
  context,
  page,
  baseURL,
}) => {
  const profCookie = await cookieHeader(ctx.prof, 'faculty')
  const started = await fetch(`${baseURL}/api/courses/${ctx.courseId}/sessions`, {
    method: 'POST',
    headers: { cookie: profCookie, 'content-type': 'application/json' },
    body: JSON.stringify({ rotationSeconds: 5, declaredDisplayCount: 1 }),
  })
  expect(started.status).toBe(200)
  const session = await started.json()

  // A second start is refused now that a session is open (the unique-index guard).
  const again = await fetch(`${baseURL}/api/courses/${ctx.courseId}/sessions`, {
    method: 'POST',
    headers: { cookie: profCookie, 'content-type': 'application/json' },
    body: JSON.stringify({ rotationSeconds: 5, declaredDisplayCount: 1 }),
  })
  expect(again.status).toBe(409)

  // Mark the way the scanner would: a token derived from the live secret.
  const secret = await sessionSecret(session.id)
  const token = deriveQrToken(secret.secret, session.id, currentCounter(secret.startedAt, 5))
  const studentCookie = await cookieHeader(STUDENT, 'student')
  const mark = await fetch(`${baseURL}/api/attendance/mark`, {
    method: 'POST',
    headers: { cookie: studentCookie, 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: session.id, token, geoDenied: true }),
  })
  expect(mark.status).toBe(200)

  // Stats count the ERP roster (5 rows) with one present.
  const stats = await fetch(`${baseURL}/api/sessions/${session.id}/stats`, { headers: { cookie: profCookie } })
  const statsBody = await stats.json()
  expect(statsBody.roster).toBe(5)
  expect(statsBody.marked).toBe(1)

  const ended = await fetch(`${baseURL}/api/sessions/${session.id}/end`, {
    method: 'POST',
    headers: { cookie: profCookie },
  })
  expect(ended.status).toBe(200)

  // The student's home reflects the attended, finished class.
  await signInAs(context, STUDENT, 'student')
  await page.goto('/')
  const card = page.locator('a', { hasText: ctx.code })
  await expect(card.getByText('100%')).toBeVisible()
})

test('the faculty export carries the time each student marked', async ({ context, page }) => {
  await signInAs(context, ctx.prof, 'faculty')
  await page.goto(`/courses/${ctx.courseId}/session`)

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download CSV' }).click(),
  ])
  const csv = (await readFile(await download.path(), 'utf8')).replace(/^﻿/, '')
  const [header, ...rows] = csv.split('\r\n')

  expect(header).toMatch(/,\d{4}-\d{2}-\d{2} \d{2}:\d{2},/)
  expect(rows.find((row) => row.startsWith(ERP_ID))).toMatch(/,P \d{2}:\d{2},/)
})
