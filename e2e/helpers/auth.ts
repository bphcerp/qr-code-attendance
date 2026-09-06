import './env'
import { encode } from 'next-auth/jwt'
import type { BrowserContext } from '@playwright/test'

// No Google OAuth client exists outside production, so the only way to reach a
// signed-in screen is to mint the Auth.js session cookie directly -- the same
// approach scripts/verifyApp.ts uses. The cookie is a JWT signed with
// AUTH_SECRET and salted with the cookie name. Over http the name is the plain
// one; Auth.js only switches to __Secure- on a secure connection.
const COOKIE = 'authjs.session-token'

export async function mintCookie(email: string, role: 'student' | 'faculty' | 'admin') {
  return encode({
    token: { email, role, sub: email },
    secret: process.env.AUTH_SECRET!,
    salt: COOKIE,
  })
}

export async function signInAs(
  context: BrowserContext,
  email: string,
  role: 'student' | 'faculty' | 'admin',
) {
  const value = await mintCookie(email, role)
  await context.addCookies([
    {
      name: COOKIE,
      value,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ])
}

// A Cookie header for the same session, for direct API calls (starting a
// session, marking attendance) that mirror what the app's fetch() would send.
export async function cookieHeader(email: string, role: 'student' | 'faculty' | 'admin') {
  return `${COOKIE}=${await mintCookie(email, role)}`
}
