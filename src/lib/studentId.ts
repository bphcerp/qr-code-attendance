export function normalizeStudentId(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, '')
}

export function studentIdFromEmail(email: string) {
  return normalizeStudentId(email.split('@')[0] ?? '')
}
