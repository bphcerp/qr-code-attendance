import { createHmac, randomBytes, timingSafeEqual } from 'crypto'

// Crockford base32: no I, L, O or U. The first three because they're misread as
// 1, 1 and 0 from the back of a lecture theatre, and U so a random code can't
// spell something unfortunate.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

const QR_TOKEN_LENGTH = 10
const CODE_LENGTH = 6

// How many rotations back a token still counts. QR gets one tick of slack
// because a camera takes a moment to focus; the typed code gets two because
// typing six characters is slower than pointing a phone.
const QR_MAX_AGE_TICKS = 1
const CODE_MAX_AGE_TICKS = 2

// Purely for error messages -- a token this old is reported as expired rather
// than invalid, so a student who scanned a second too late is told to try again
// instead of being told their code was wrong.
const STALE_DIAGNOSTIC_TICKS = 12

// A "static" QR is the same rotation mechanism with a much longer window --
// faculty pick how long a screenshot of it stays valid, capped so it can't
// outlive a single lab block by much.
export const STATIC_MINUTES_MAX = 240

export function isValidRotationSeconds(seconds: number) {
  return (seconds >= 3 && seconds <= 30) || (seconds >= 60 && seconds <= STATIC_MINUTES_MAX * 60)
}

function encode(buf: Buffer, length: number) {
  let out = ''
  for (let i = 0; i < length; i++) {
    out += ALPHABET[buf[i] % 32]
  }
  return out
}

export function normalizeCode(input: string) {
  return input
    .trim()
    .toUpperCase()
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0')
    .replace(/[^0-9A-Z]/g, '')
}

export function newSessionSecret() {
  return randomBytes(32).toString('base64')
}

export function currentCounter(startedAt: Date, rotationSeconds: number, now = Date.now()) {
  return Math.floor((now - startedAt.getTime()) / (rotationSeconds * 1000))
}

export function nextRotationAt(startedAt: Date, rotationSeconds: number, now = Date.now()) {
  const counter = currentCounter(startedAt, rotationSeconds, now)
  return new Date(startedAt.getTime() + (counter + 1) * rotationSeconds * 1000)
}

// The QR and the typed code are derived from separate HMACs rather than one
// being a slice of the other, so learning the short code tells you nothing
// about the corresponding QR token.
function derive(secret: string, sessionId: string, counter: number, kind: 'qr' | 'code') {
  const mac = createHmac('sha256', Buffer.from(secret, 'base64'))
    .update(`${sessionId}:${counter}:${kind}`)
    .digest()
  return encode(mac, kind === 'qr' ? QR_TOKEN_LENGTH : CODE_LENGTH)
}

export function deriveQrToken(secret: string, sessionId: string, counter: number) {
  return derive(secret, sessionId, counter, 'qr')
}

export function deriveCode(secret: string, sessionId: string, counter: number) {
  return derive(secret, sessionId, counter, 'code')
}

function equals(a: string, b: string) {
  if (a.length !== b.length) return false
  return timingSafeEqual(Buffer.from(a), Buffer.from(b))
}

export type VerifyResult =
  | { ok: true; counter: number; kind: 'qr' | 'code' }
  | { ok: false; reason: 'expired' | 'invalid' }

/**
 * The counter is not carried in the payload. Dropping it keeps the QR at ten
 * characters instead of thirteen, and QR module size -- which is what decides
 * whether row 20 can scan it -- is set by payload length. The cost is checking
 * two or three candidate counters instead of one, which is a rounding error.
 */
export function verifyToken(
  input: string,
  secret: string,
  sessionId: string,
  startedAt: Date,
  rotationSeconds: number,
  now = Date.now(),
): VerifyResult {
  const value = normalizeCode(input)
  const kind: 'qr' | 'code' =
    value.length === QR_TOKEN_LENGTH ? 'qr' : value.length === CODE_LENGTH ? 'code' : 'qr'

  if (value.length !== QR_TOKEN_LENGTH && value.length !== CODE_LENGTH) {
    return { ok: false, reason: 'invalid' }
  }

  const counter = currentCounter(startedAt, rotationSeconds, now)
  const maxAge = kind === 'qr' ? QR_MAX_AGE_TICKS : CODE_MAX_AGE_TICKS

  for (let age = 0; age <= maxAge; age++) {
    const candidate = counter - age
    if (candidate < 0) break
    if (equals(value, derive(secret, sessionId, candidate, kind))) {
      return { ok: true, counter: candidate, kind }
    }
  }

  for (let age = maxAge + 1; age <= STALE_DIAGNOSTIC_TICKS; age++) {
    const candidate = counter - age
    if (candidate < 0) break
    if (equals(value, derive(secret, sessionId, candidate, kind))) {
      return { ok: false, reason: 'expired' }
    }
  }

  return { ok: false, reason: 'invalid' }
}
