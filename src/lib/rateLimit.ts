import { and, eq, lt, sql } from 'drizzle-orm'
import { db } from '@/db'
import { rateLimitBuckets } from '@/db/schema'
import { HttpError } from './guards'

type RateLimitOptions = {
  scope: string
  keyHash: string
  limit: number
  windowSeconds: number
}

export async function enforceRateLimit({
  scope,
  keyHash,
  limit,
  windowSeconds,
}: RateLimitOptions) {
  const now = Date.now()
  const windowMs = windowSeconds * 1000
  const windowStart = new Date(Math.floor(now / windowMs) * windowMs)
  const [bucket] = await db
    .insert(rateLimitBuckets)
    .values({ scope, keyHash, windowStart, count: 1 })
    .onConflictDoUpdate({
      target: [rateLimitBuckets.scope, rateLimitBuckets.keyHash, rateLimitBuckets.windowStart],
      set: { count: sql`${rateLimitBuckets.count} + 1` },
    })
    .returning({ count: rateLimitBuckets.count })

  if (Math.random() < 0.01) {
    await db
      .delete(rateLimitBuckets)
      .where(lt(rateLimitBuckets.windowStart, new Date(now - 24 * 60 * 60 * 1000)))
  }

  if (bucket.count > limit) {
    const retryAfter = Math.max(1, Math.ceil((windowStart.getTime() + windowMs - now) / 1000))
    throw new HttpError(429, 'rate_limited', retryAfter)
  }
}

export async function clearRateLimit(scope: string, keyHash: string) {
  await db
    .delete(rateLimitBuckets)
    .where(and(eq(rateLimitBuckets.scope, scope), eq(rateLimitBuckets.keyHash, keyHash)))
}
