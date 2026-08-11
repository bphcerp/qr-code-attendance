// Corroborating signal for the device cookie, not an identifier on its own.
// Canvas and WebGL entropy would collide far less, and are deliberately left
// out: this never blocks anyone by itself, and a materially more invasive
// fingerprint on 600 students is a bad trade under DPDP for a soft flag.
export async function deviceFingerprint() {
  const parts = [
    navigator.userAgent,
    `${screen.width}x${screen.height}x${screen.colorDepth}`,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    String(navigator.hardwareConcurrency ?? ''),
  ].join('|')

  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(parts))
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32)
}
