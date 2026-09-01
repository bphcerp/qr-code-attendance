// The parts of the token scheme that the browser is allowed to know: how long a
// typed code is, and which rotation windows the control page may ask for.
//
// These live here rather than in token.ts because that module opens with
// `import { ... } from 'crypto'`. Importing a single constant from it pulls
// Node's crypto -- and the whole HMAC derivation -- into the client bundle for
// whichever route did the importing, which is not something a browser build can
// resolve. Client components import this file; token.ts re-exports it so server
// callers keep one import site.

export const CODE_LENGTH = 6

// A "static" QR is the same rotation mechanism with a much longer window --
// faculty pick how long a screenshot of it stays valid, capped so it can't
// outlive a single lab block by much.
export const STATIC_MINUTES_MAX = 240

export function isValidRotationSeconds(seconds: number) {
  return (seconds >= 3 && seconds <= 30) || (seconds >= 60 && seconds <= STATIC_MINUTES_MAX * 60)
}
