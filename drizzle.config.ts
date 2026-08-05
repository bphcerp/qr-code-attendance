import type { Config } from 'drizzle-kit'

// drizzle-kit only picks up .env, and Next uses .env.local -- without this the
// two disagree about which database they're pointed at, which is a bad way to
// find out you've migrated the wrong one.
try {
  process.loadEnvFile('.env.local')
} catch {
  // no .env.local (CI, or env supplied directly) -- fall through to process.env
}

// Migrations go over the direct connection, not the pooler. PgBouncer in
// transaction mode can't run the DDL + advisory locks drizzle-kit needs.
export default {
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL!,
  },
} satisfies Config
