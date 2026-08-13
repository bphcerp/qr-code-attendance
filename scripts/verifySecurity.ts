import postgres from 'postgres'

const connectionUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL
if (!connectionUrl) throw new Error('DIRECT_URL or DATABASE_URL is required')

const sql = postgres(connectionUrl, { max: 1 })
let passed = 0

function check(label: string, condition: boolean, detail = '') {
  if (!condition) throw new Error(`${label}${detail ? `: ${detail}` : ''}`)
  passed++
}

const expectedPublicGrants: Record<string, string[]> = {
  attendance_flags: ['INSERT', 'SELECT'],
  attendance_records: ['INSERT', 'SELECT'],
  audit_log: ['INSERT'],
  class_sessions: ['INSERT', 'SELECT', 'UPDATE'],
  course_roster: ['DELETE', 'INSERT', 'SELECT', 'UPDATE'],
  courses: ['INSERT', 'SELECT'],
  devices: ['INSERT', 'SELECT'],
  display_tokens: ['INSERT', 'SELECT', 'UPDATE'],
  enrollments: ['DELETE', 'INSERT', 'SELECT'],
  student_directory: ['SELECT'],
  users: ['INSERT', 'SELECT'],
}

async function main() {
  const expectedTables = [
    'attendance_flags',
    'attendance_records',
    'audit_log',
    'class_sessions',
    'course_roster',
    'courses',
    'device_rebind_requests',
    'devices',
    'display_tokens',
    'enrollments',
    'review_requests',
    'student_directory',
    'users',
  ]

  const rlsRows = await sql<{ table_name: string; rls: boolean }[]>`
    select c.relname as table_name, c.relrowsecurity as rls
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relname = any(${expectedTables})
  `
  check('every application table exists', rlsRows.length === expectedTables.length)
  check('RLS is enabled on every application table', rlsRows.every((row) => row.rls))

  const roleRows = await sql<{
    rolcanlogin: boolean
    rolsuper: boolean
    rolinherit: boolean
    rolcreaterole: boolean
    rolcreatedb: boolean
    rolreplication: boolean
    rolbypassrls: boolean
  }[]>`
    select rolcanlogin, rolsuper, rolinherit, rolcreaterole, rolcreatedb,
           rolreplication, rolbypassrls
    from pg_roles where rolname = 'attendance_app'
  `
  check('attendance_app role exists', roleRows.length === 1)
  const role = roleRows[0]
  check(
    'attendance_app is unprivileged',
    !role.rolsuper && !role.rolinherit && !role.rolcreaterole && !role.rolcreatedb &&
      !role.rolreplication && !role.rolbypassrls,
  )

  const owners = await sql<{ table_name: string }[]>`
    select c.relname as table_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'private')
      and c.relkind = 'r'
      and pg_get_userbyid(c.relowner) = 'attendance_app'
  `
  check('attendance_app owns no tables', owners.length === 0)

  const [schemaPrivileges] = await sql<{
    public_create: boolean
    private_create: boolean
  }[]>`
    select has_schema_privilege('attendance_app', 'public', 'CREATE') as public_create,
           has_schema_privilege('attendance_app', 'private', 'CREATE') as private_create
  `
  check('attendance_app cannot create schema objects', !schemaPrivileges.public_create && !schemaPrivileges.private_create)

  const grantRows = await sql<{ table_name: string; privilege_type: string }[]>`
    select table_name, privilege_type
    from information_schema.role_table_grants
    where grantee = 'attendance_app' and table_schema = 'public'
  `
  const actualGrants = new Map<string, string[]>()
  for (const grant of grantRows) {
    const values = actualGrants.get(grant.table_name) ?? []
    values.push(grant.privilege_type)
    actualGrants.set(grant.table_name, values)
  }
  const normalizedActual = Object.fromEntries(
    [...actualGrants].sort(([left], [right]) => left.localeCompare(right)).map(([table, grants]) => [table, grants.sort()]),
  )
  check(
    'public table grants match the operation matrix',
    JSON.stringify(normalizedActual) === JSON.stringify(expectedPublicGrants),
    JSON.stringify(normalizedActual),
  )

  const privateGrants = await sql<{ privilege_type: string }[]>`
    select privilege_type
    from information_schema.role_table_grants
    where grantee = 'attendance_app'
      and table_schema = 'private'
      and table_name = 'rate_limit_buckets'
    order by privilege_type
  `
  check(
    'rate-limit table grants are exact',
    JSON.stringify(privateGrants.map((row) => row.privilege_type)) ===
      JSON.stringify(['DELETE', 'INSERT', 'SELECT', 'UPDATE']),
  )

  const rawColumns = await sql<{ table_name: string; column_name: string }[]>`
    select table_name, column_name
    from information_schema.columns
    where table_schema = 'public' and (
      (table_name = 'attendance_records' and column_name in ('fingerprint', 'ip', 'user_agent', 'lat', 'lng', 'accuracy'))
      or (table_name = 'audit_log' and column_name = 'ip')
      or (table_name = 'devices' and column_name in ('fingerprint', 'user_agent'))
      or (table_name = 'display_tokens' and column_name = 'pinned_ip')
    )
  `
  check('raw telemetry columns were purged', rawColumns.length === 0, JSON.stringify(rawColumns))

  const apiRoles = await sql<{ rolname: string }[]>`
    select rolname from pg_roles where rolname in ('anon', 'authenticated', 'service_role')
  `
  for (const apiRole of apiRoles) {
    const [privileges] = await sql<{ can_select: boolean; can_insert: boolean }[]>`
      select has_table_privilege(${apiRole.rolname}, 'public.users', 'SELECT') as can_select,
             has_table_privilege(${apiRole.rolname}, 'public.users', 'INSERT') as can_insert
    `
    check(`${apiRole.rolname} has no Data API table access`, !privileges.can_select && !privileges.can_insert)
  }

  const defaultLeaks = await sql<{ owner_name: string; grantee_name: string }[]>`
    select pg_get_userbyid(d.defaclrole) as owner_name,
           coalesce(r.rolname, 'PUBLIC') as grantee_name
    from pg_default_acl d
    join pg_namespace n on n.oid = d.defaclnamespace
    cross join lateral aclexplode(d.defaclacl) acl
    left join pg_roles r on r.oid = acl.grantee
    where n.nspname = 'public'
      and pg_get_userbyid(d.defaclrole) in ('postgres', 'supabase_admin')
      and coalesce(r.rolname, 'PUBLIC') in ('anon', 'authenticated', 'service_role', 'PUBLIC')
  `
  check('automatic default privileges are revoked', defaultLeaks.length === 0, JSON.stringify(defaultLeaks))

  console.log(`${passed} database security checks passed`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => sql.end())
