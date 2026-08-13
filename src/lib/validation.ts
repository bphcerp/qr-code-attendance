import { HttpError } from './guards'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function requireUuid(value: string) {
  if (!UUID.test(value)) throw new HttpError(400, 'bad_request')
  return value
}

export async function readJsonObject(req: Request, maxBytes: number) {
  const contentType = req.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase()
  if (contentType !== 'application/json') throw new HttpError(415, 'unsupported_media_type')

  const text = await req.text()
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    throw new HttpError(413, 'payload_too_large')
  }

  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new HttpError(400, 'bad_request')
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'bad_request')
  }
  return value as Record<string, unknown>
}

export function optionalFiniteNumber(value: unknown, min: number, max: number) {
  if (value == null) return null
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new HttpError(400, 'bad_request')
  }
  return value
}
