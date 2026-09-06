import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

let instance: PostgresJsDatabase<typeof schema> | null = null

function connect() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')

  // Supabase's pooler runs PgBouncer in transaction mode, which cannot hold the
  // server-side state prepared statements need. postgres.js prepares by
  // default, so leaving this on produces "prepared statement already exists"
  // under real concurrency -- which is exactly the 600-marks-at-once case.
  return drizzle(postgres(url, { prepare: false }), { schema })
}

// Connecting lazily rather than at import: `next build` loads every route module
// to collect page data, and a build machine without DATABASE_URL would fail
// there instead of at the first query.
export const db = new Proxy({} as PostgresJsDatabase<typeof schema>, {
  get(_target, prop) {
    instance ??= connect()
    return Reflect.get(instance, prop, instance)
  },
})

// The transaction handle Drizzle hands to a `db.transaction` callback, derived
// from `db` itself so a helper can accept `tx` without importing Drizzle's
// internal generics.
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
