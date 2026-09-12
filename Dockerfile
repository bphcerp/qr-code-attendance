# Shape follows bphcerp/dadu-home so the deploy box has one pattern to reason
# about, not two: node:22-slim, deps -> builder -> runner, and the runner takes
# the whole node_modules rather than a pruned production install.
#
# That last part is not just conformity. `output: 'standalone'` would give a
# much smaller image, but it only traces what app code imports, and
# scripts/deployMigrate.ts pulls in drizzle-orm/postgres-js/migrator, which
# nothing under src/ imports -- so the migrator would be missing at exactly the
# moment the entrypoint needs it. Keeping the full tree also keeps tsx (so the
# existing migrate script runs unchanged) and typescript (which `next start`
# needs to read the TypeScript next.config.ts, and the security headers live
# in there).
FROM node:22-slim AS base

FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts skips embedded-postgres' postinstall, which downloads a
# ~100 MB Postgres binary for scripts/localDb.ts. That is a dev-only path and
# the deploy workflow builds with --no-cache, so it would be re-downloaded on
# every single push. Nothing in `next build` depends on a postinstall having
# run. If a build ever fails on a missing binary, this flag is the first thing
# to drop.
RUN npm ci --ignore-scripts

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Plain `next build`, not `vercel-build` -- migrations are the entrypoint's job
# now, and running them at build time would migrate the database before the
# image that needs the new schema is even known to work.
RUN npm run build

FROM base AS runner
WORKDIR /app
# Next runs in production mode, and cookies/security behaviour that keys off
# NODE_ENV (the `secure` flag on the session cookie, error verbosity) then
# behaves as it does on Vercel rather than as in dev.
ENV NODE_ENV=production

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./
COPY --from=builder /app/next.config.ts ./
COPY --from=builder /app/tsconfig.json ./
# The migrator resolves migrationsFolder: 'drizzle' relative to cwd, so the SQL
# has to travel with the image. scripts/ imports nothing from src/.
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/scripts ./scripts

# --force because deployMigrate.ts gates on VERCEL_ENV=production, which is
# never set off Vercel -- without it the script prints "skip migrations" and the
# app starts against whatever schema happens to be there.
#
# The && is the point: a migration that *fails* takes the container down with
# it, and restart: unless-stopped turns that into a visible crash loop rather
# than a healthy-looking server on the wrong schema.
#
# One gap to know about: DIRECT_URL being absent is not a failure. The script
# warns and exits 0 by design (it was written so a config problem could not
# block every Vercel deploy, including the one that fixes it), so the app will
# come up having applied nothing. Off Vercel that warning is only in the
# container logs, so DIRECT_URL really does have to be in the server .env.
CMD ["sh", "-c", "node_modules/.bin/tsx scripts/deployMigrate.ts --force && node_modules/.bin/next start -p ${PORT}"]
