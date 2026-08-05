// Drizzle wraps driver errors in a DrizzleQueryError whose message is only
// "Failed query: <sql>" -- the Postgres code and constraint name live on
// .cause. Matching on the outer message silently never fires, which turns a
// duplicate mark into a 500 instead of "you're already marked".
export function isUniqueViolation(err: unknown, constraint?: string) {
  const cause = (err as { cause?: { code?: string; constraint_name?: string } })?.cause
  if (cause?.code !== '23505') return false
  return constraint ? cause.constraint_name === constraint : true
}
