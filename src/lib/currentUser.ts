import { cache } from 'react'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { users } from '@/db/schema'

// Layout and page both need the signed-in user's row on every navigation --
// cache() collapses that to one query per request instead of two.
export const getCurrentUser = cache(async (email: string) => {
  const [me] = await db
    .select({ name: users.name, role: users.role })
    .from(users)
    .where(eq(users.email, email))
  return me
})
