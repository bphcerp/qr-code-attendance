import { createHmac, timingSafeEqual } from 'crypto'
import { and, eq, isNull } from 'drizzle-orm'
import { db, type Tx } from '@/db'
import { devices } from '@/db/schema'

export const DEVICE_COOKIE = 'att_device'

function sign(deviceId: string) {
  return createHmac('sha256', process.env.AUTH_SECRET!).update(deviceId).digest('base64url')
}

export function serializeDeviceCookie(deviceId: string) {
  return `${deviceId}.${sign(deviceId)}`
}

function parseDeviceCookie(raw: string | undefined) {
  if (!raw) return null
  const idx = raw.lastIndexOf('.')
  if (idx < 0) return null
  const deviceId = raw.slice(0, idx)
  const mac = raw.slice(idx + 1)
  const expected = sign(deviceId)
  // Compare byte length, not string length: a mac that is 43 characters but
  // more than 43 bytes (a multibyte character slipped in) passes a `.length`
  // check and then makes timingSafeEqual throw a RangeError on the unequal
  // buffers -- a crafted cookie turning into a 500. token.ts is safe because it
  // strips input to ASCII first; this parser never did.
  const macBuf = Buffer.from(mac)
  const expectedBuf = Buffer.from(expected)
  if (macBuf.length !== expectedBuf.length) return null
  if (!timingSafeEqual(macBuf, expectedBuf)) return null
  return deviceId
}

async function activeDeviceFor(userEmail: string) {
  const [row] = await db
    .select()
    .from(devices)
    .where(and(eq(devices.userEmail, userEmail), isNull(devices.revokedAt)))
  return row ?? null
}

// The id of a student's active device, or null. Used by the mark route to adopt
// the device that won a simultaneous first-mark: it belongs to this same
// student, so a request that lost the registration race proceeds against it.
export async function activeDeviceIdFor(userEmail: string) {
  const active = await activeDeviceFor(userEmail)
  return active?.id ?? null
}

// Writes the device row inside a caller-supplied transaction so the binding and
// the attendance record it belongs to commit or roll back together -- a scan
// that fails after this point must leave no device behind.
export async function registerDeviceTx(
  tx: Tx,
  userEmail: string,
  fingerprint: string,
  ua: string | null,
) {
  const [row] = await tx
    .insert(devices)
    .values({ userEmail, fingerprint, userAgent: ua })
    .returning({ id: devices.id })
  return row.id
}

// Releases a student's active binding so they can register a new phone. Returns
// whether a row was actually freed -- a student with no active device is a
// no-op, not an error.
export async function releaseActiveDevice(userEmail: string) {
  const released = await db
    .update(devices)
    .set({ revokedAt: new Date() })
    .where(and(eq(devices.userEmail, userEmail), isNull(devices.revokedAt)))
    .returning({ id: devices.id })
  return released.length > 0
}

export type DeviceDecision =
  | { ok: true; deviceId: string | null; needsRegistration: boolean; recentlyRebound: boolean }
  | { ok: false }

// A student's first mark registers whatever device they're holding; every mark
// after that has to come from the same one. The cookie is the identifier and the
// fingerprint corroborates it -- neither is a hardware root of trust, and a
// determined student can copy a cookie. What this reliably stops is the ordinary
// case, a friend signing into your account on their phone and marking twice,
// because their phone already carries their own device row.
//
// This is read-only: it decides whether the mark may proceed and whether a new
// device has to be written, but never writes. The write happens in the caller's
// transaction (registerDeviceTx), so a decision made here can't leave a dangling
// binding if the mark that follows it fails.
export async function resolveDevice(
  userEmail: string,
  cookieValue: string | undefined,
): Promise<DeviceDecision> {
  const cookieDeviceId = parseDeviceCookie(cookieValue)

  // A phone that already belongs to someone else cannot enrol a second student,
  // even one who has never registered a device. Without this, a student signing
  // into their own account on a friend's phone gets a fresh registration and the
  // single handset marks both of them -- which is the whole attack this is
  // supposed to prevent. A revoked row doesn't count: that device was released
  // by an approved rebind and is free to be claimed again.
  if (cookieDeviceId) {
    const [owner] = await db
      .select({ userEmail: devices.userEmail, revokedAt: devices.revokedAt })
      .from(devices)
      .where(eq(devices.id, cookieDeviceId))
    if (owner && !owner.revokedAt && owner.userEmail !== userEmail) return { ok: false }
  }

  const active = await activeDeviceFor(userEmail)

  if (!active) {
    return { ok: true, deviceId: null, needsRegistration: true, recentlyRebound: false }
  }

  if (!cookieDeviceId || cookieDeviceId !== active.id) return { ok: false }

  const recentlyRebound = Date.now() - active.registeredAt.getTime() < 24 * 3600 * 1000
  return { ok: true, deviceId: active.id, needsRegistration: false, recentlyRebound }
}
