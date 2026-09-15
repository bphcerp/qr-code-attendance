// Vercel sets x-forwarded-for and prepends the real client on each hop, so the
// first entry is the one to trust. Only recorded on attendance and audit rows
// now -- nothing grants or refuses access by it.
export function clientIp(req: Request) {
  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0].trim()
  return req.headers.get('x-real-ip') ?? null
}

export function userAgent(req: Request) {
  return req.headers.get('user-agent')
}
