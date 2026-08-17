import { eq } from 'drizzle-orm'
import { db } from '../src/db'
import { users, auditLog } from '../src/db/schema'

// Solves the chicken-and-egg: promoting to admin requires an admin, so the
// first ones come from env instead. Idempotent -- safe to re-run on every
// deploy. Accounts that have never signed in are skipped rather than created,
// because a row here with no matching Google account is a role waiting to be
// claimed by whoever registers that address first.
async function main() {
  const emails = (process.env.INITIAL_ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)

  if (!emails.length) {
    console.log('INITIAL_ADMIN_EMAILS is empty, nothing to do')
    return
  }

  for (const email of emails) {
    const [existing] = await db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.email, email))

    if (!existing) {
      console.log(`skip ${email} -- has not signed in yet`)
      continue
    }
    if (existing.role === 'admin') {
      console.log(`ok   ${email} -- already admin`)
      continue
    }

    await db.update(users).set({ role: 'admin' }).where(eq(users.email, email))
    await db.insert(auditLog).values({
      actorEmail: 'seed-script',
      action: 'role.change',
      subject: email,
      detail: { from: existing.role, to: 'admin' },
    })
    console.log(`done ${email} -- ${existing.role} -> admin`)
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
