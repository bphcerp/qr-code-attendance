import NextAuth from 'next-auth'
import Google from 'next-auth/providers/google'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { users } from '@/db/schema'

const allowedDomains = (process.env.ALLOWED_EMAIL_DOMAINS ?? '')
  .split(',')
  .map((d) => d.trim().toLowerCase())
  .filter(Boolean)

export function isAllowedEmail(email: string | null | undefined) {
  if (!email) return false
  const domain = email.split('@')[1]?.toLowerCase()
  if (!domain) return false
  return allowedDomains.includes(domain)
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      // hd only filters the account chooser -- it's a hint to Google, not a
      // guarantee, and a determined user can still complete the flow with any
      // account. The signIn callback below is the actual gate.
      authorization: { params: { hd: allowedDomains[0], prompt: 'select_account' } },
    }),
  ],
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
  callbacks: {
    async signIn({ user }) {
      const email = user.email?.toLowerCase()
      if (!isAllowedEmail(email)) return false

      // Every new account is a student. Role is never inferred from the email
      // pattern -- a wrong guess in either direction is a privilege bug -- and
      // an existing user's role is deliberately left untouched on re-login.
      await db
        .insert(users)
        .values({ email: email!, name: user.name ?? email!, campus: email!.split('@')[1] })
        .onConflictDoNothing()

      return true
    },

    // Only on sign-in and explicit session refresh. Doing this on every decode
    // would mean a DB round trip per request, and a 600-student scan burst is
    // the worst possible time to add one. The role in the token is therefore a
    // UI hint that can go stale -- anything privileged re-reads it through
    // requireRole() in guards.ts instead of trusting this.
    async jwt({ token, trigger }) {
      if (!token.email) return token
      if (trigger !== 'signIn' && trigger !== 'signUp' && trigger !== 'update' && token.role) {
        return token
      }
      const [row] = await db
        .select({ role: users.role })
        .from(users)
        .where(eq(users.email, token.email.toLowerCase()))
      token.role = row?.role ?? 'student'
      return token
    },

    async session({ session, token }) {
      if (session.user) {
        session.user.email = (token.email as string) ?? session.user.email
        session.user.role = (token.role as string) ?? 'student'
      }
      return session
    },
  },
})
