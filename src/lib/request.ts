// Vercel sets x-forwarded-for and prepends the real client on each hop, so the
// first entry is the one to trust. Behind a different proxy this needs
// revisiting -- a spoofable client IP would break the display-token pin.
export function clientIp(req: Request) {
  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0].trim()
  return req.headers.get('x-real-ip') ?? null
}
