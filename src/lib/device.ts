import { createHmac, timingSafeEqual } from 'crypto'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '@/db'
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
  if (mac.length !== expected.length) return null
  if (!timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null
  return deviceId
}

async function activeDeviceFor(userEmail: string) {
  const [row] = await db
    .select()
    .from(devices)
    .where(and(eq(devices.userEmail, userEmail), isNull(devices.revokedAt)))
  return row ?? null
}

async function registerDevice(userEmail: string, fingerprint: string, ua: string | null) {
  const [row] = await db
    .insert(devices)
    .values({ userEmail, fingerprint, userAgent: ua })
    .returning()
  return row
}

export type DeviceCheck =
  | { ok: true; deviceId: string; justRegistered: boolean; recentlyRebound: boolean }
  | { ok: false }

// A student's first mark registers whatever device they're holding; every mark
// after that has to come from the same one. The cookie is the identifier and the
// fingerprint corroborates it -- neither is a hardware root of trust, and a
// determined student can copy a cookie. What this reliably stops is the ordinary
// case, a friend signing into your account on their phone and marking twice,
// because their phone already carries their own device row.
export async function checkDevice(
  userEmail: string,
  cookieValue: string | undefined,
  fingerprint: string,
  ua: string | null,
): Promise<DeviceCheck> {
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
    const created = await registerDevice(userEmail, fingerprint, ua)
    return { ok: true, deviceId: created.id, justRegistered: true, recentlyRebound: false }
  }

  if (!cookieDeviceId || cookieDeviceId !== active.id) return { ok: false }

  const recentlyRebound = Date.now() - active.registeredAt.getTime() < 24 * 3600 * 1000
  return { ok: true, deviceId: active.id, justRegistered: false, recentlyRebound }
}
