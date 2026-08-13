import postgres from 'postgres'

const connectionUrl = process.env.DIRECT_URL
if (!connectionUrl) throw new Error('DIRECT_URL is required for the production security preflight')

const sql = postgres(connectionUrl, { max: 1 })

async function main() {
  const [result] = await sql<{
    open_sessions: number
    applied_migrations: number
    exposed_grants: number
  }[]>`
    select
      (select count(*)::int from public.class_sessions where ended_at is null) as open_sessions,
      (select count(*)::int from drizzle.__drizzle_migrations) as applied_migrations,
      (
        select count(*)::int
        from information_schema.role_table_grants
        where table_schema = 'public'
          and grantee in ('anon', 'authenticated', 'service_role')
      ) as exposed_grants
  `

  console.log(JSON.stringify(result))
  if (result.open_sessions !== 0) {
    throw new Error('Production has an open attendance session; stop the rollout')
  }
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => sql.end())
