import { createHmac } from 'crypto'

function pepper() {
  const value = process.env.SECURITY_PEPPER
  if (value && value.length >= 32) return value

  if (process.env.NODE_ENV !== 'production') {
    const fallback = process.env.AUTH_SECRET
    if (fallback) return fallback
  }

  throw new Error('SECURITY_PEPPER must be at least 32 characters')
}

export function securityHash(namespace: string, value: string) {
  return createHmac('sha256', pepper())
    .update(namespace)
    .update('\0')
    .update(value)
    .digest('hex')
}
