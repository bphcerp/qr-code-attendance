// A client can send anything JSON allows, and a NaN, a string, or a value out
// of a column's range turns into a Postgres 500 the moment it reaches the
// driver. These coerce untrusted numbers at the edge instead.

export function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, Math.trunc(value)))
}
