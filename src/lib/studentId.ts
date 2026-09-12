export function normalizeStudentId(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, '')
}

export function studentIdFromEmail(email: string) {
  return normalizeStudentId(email.split('@')[0] ?? '')
}

// The one identifier every form of a student's number agrees on: the eight
// digits (year + serial) that the campus email is built from. A roster export
// gives us the ERP id (411 + those eight, e.g. 41120261453), the campus id
// card number (2026B5PS1453H), or occasionally the bare username (f20261453);
// none of them equal the email local part on the nose, which is why uploading a
// real sheet used to enrol nobody. Stripping to digits and keeping the last
// eight collapses the ERP id, the username and the full email onto the same
// key. See scripts/seed/student_directory.sql for the 411 + core convention.
//
// It is deliberately letter-agnostic (the f/h that separates first-degree from
// higher-degree accounts is dropped): within one course everyone shares a
// degree letter, so the core alone is unique. Across degree types two accounts
// could in theory share a core, which is why an explicit email column, when the
// sheet has one, is matched ahead of this. The campus id card number does NOT
// reduce to the core (its digits carry the degree code), so a sheet that only
// has that column will not match here -- the upload's enrolled count surfaces
// that rather than hiding it.
export function emailCore(value: string) {
  const digits = value.replace(/\D/g, '')
  return digits.length >= 8 ? digits.slice(-8) : normalizeStudentId(value)
}

export function emailCoreFromEmail(email: string) {
  return emailCore(email.split('@')[0] ?? '')
}
