import postgres from 'postgres'

const adminUrl = process.env.DIRECT_URL
const sourceRuntimeUrl = process.env.SOURCE_DATABASE_URL
const password = process.env.ATTENDANCE_APP_PASSWORD

if (!adminUrl || !sourceRuntimeUrl || !password) {
  throw new Error('DIRECT_URL, SOURCE_DATABASE_URL, and ATTENDANCE_APP_PASSWORD are required')
}
if (!/^[A-Za-z0-9_-]{40,}$/.test(password)) {
  throw new Error('ATTENDANCE_APP_PASSWORD must be a 40+ character base64url value')
}

const runtimeUrl = new URL(sourceRuntimeUrl)
const usernameSuffix = runtimeUrl.username.includes('.')
  ? runtimeUrl.username.slice(runtimeUrl.username.indexOf('.'))
  : ''
runtimeUrl.username = `attendance_app${usernameSuffix}`
runtimeUrl.password = password

async function main() {
  const admin = postgres(adminUrl, { max: 1 })
  try {
    await admin.unsafe(`ALTER ROLE attendance_app WITH LOGIN PASSWORD '${password}'`)
  } finally {
    await admin.end()
  }

  const runtime = postgres(runtimeUrl.toString(), { max: 1 })
  try {
    const [identity] = await runtime<{
      current_user: string
      rolbypassrls: boolean
      rolcreaterole: boolean
      rolcreatedb: boolean
      rolsuper: boolean
    }[]>`
      select current_user, rolbypassrls, rolcreaterole, rolcreatedb, rolsuper
      from pg_roles where rolname = current_user
    `
    if (
      identity.current_user !== 'attendance_app' || identity.rolbypassrls ||
      identity.rolcreaterole || identity.rolcreatedb || identity.rolsuper
    ) {
      throw new Error('Runtime connection did not assume the restricted attendance_app role')
    }

    await runtime`select count(*) from public.users`

    let blockedUnusedTable = false
    try {
      await runtime`select count(*) from public.review_requests`
    } catch (error) {
      blockedUnusedTable = (error as { code?: string }).code === '42501'
    }
    if (!blockedUnusedTable) throw new Error('Runtime role can access review_requests')

    let blockedCreate = false
    try {
      await runtime.unsafe('create table public.attendance_security_probe (id int)')
    } catch (error) {
      blockedCreate = (error as { code?: string }).code === '42501'
    }
    if (!blockedCreate) throw new Error('Runtime role can create public schema objects')
  } finally {
    await runtime.end()
  }

  process.stdout.write(runtimeUrl.toString())
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
