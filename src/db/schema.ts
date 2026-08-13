import {
  pgTable,
  pgEnum,
  text,
  varchar,
  integer,
  doublePrecision,
  timestamp,
  uuid,
  jsonb,
  primaryKey,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const roleEnum = pgEnum('role', ['student', 'faculty', 'admin'])
export const attendanceSourceEnum = pgEnum('attendance_source', ['qr', 'code', 'manual'])
export const requestStatusEnum = pgEnum('request_status', ['pending', 'approved', 'rejected'])

export const users = pgTable('users', {
  email: varchar('email').primaryKey(),
  name: varchar('name').notNull(),
  role: roleEnum('role').notNull().default('student'),
  campus: varchar('campus'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const devices = pgTable(
  'devices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userEmail: varchar('user_email')
      .notNull()
      .references(() => users.email, { onDelete: 'cascade' }),
    fingerprint: varchar('fingerprint').notNull(),
    userAgent: text('user_agent'),
    registeredAt: timestamp('registered_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [
    // one active device per student, enforced here rather than in the mark
    // endpoint -- a race between two simultaneous registrations would slip past
    // an application-level check
    uniqueIndex('devices_one_active_per_user')
      .on(table.userEmail)
      .where(sql`revoked_at is null`),
  ],
)

export const courses = pgTable(
  'courses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: varchar('code').notNull(),
    title: varchar('title').notNull(),
    facultyEmail: varchar('faculty_email')
      .notNull()
      .references(() => users.email),
  },
  (table) => [index('courses_faculty_email_idx').on(table.facultyEmail)],
)

// Everyone who teaches a course, so a course is not the property of whoever
// happened to create it. Courses shared between two or three instructors are
// the normal case here, not the exception -- lectures and tutorials for the
// same course are frequently not the same person.
//
// `courses.facultyEmail` stays as the owner: it is who created the course, who
// is shown to students, and the only one who can change this list. Every owner
// is also a row here, backfilled in 0006, so permission checks read one table
// instead of having to remember to check both.
export const courseFaculty = pgTable(
  'course_faculty',
  {
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    facultyEmail: varchar('faculty_email')
      .notNull()
      .references(() => users.email, { onDelete: 'cascade' }),
    addedByEmail: varchar('added_by_email').references(() => users.email),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.courseId, table.facultyEmail] }),
    // "which courses do I teach" is the query behind every faculty screen, and
    // facultyEmail is the second column of the PK above, so it cannot lead.
    index('course_faculty_email_idx').on(table.facultyEmail),
  ],
)

// An address an admin has designated as faculty *before* it has ever signed in.
// It is deliberately not a `users` row with role='faculty': writing one for an
// account that has never authenticated leaves a privileged role sitting there
// for whoever registers that address first, which is the same reason
// scripts/seedAdmin.ts skips unknown addresses rather than creating them. The
// invite is claimed in the signIn callback, so the role only ever lands on an
// account Google has actually authenticated.
export const facultyInvites = pgTable('faculty_invites', {
  email: varchar('email').primaryKey(),
  invitedByEmail: varchar('invited_by_email')
    .notNull()
    .references(() => users.email),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  // null until that address signs in and the role is granted. Kept rather than
  // deleted so the dashboard can show that an invite was taken up, and by when.
  claimedAt: timestamp('claimed_at', { withTimezone: true }),
})

export const enrollments = pgTable(
  'enrollments',
  {
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    studentEmail: varchar('student_email')
      .notNull()
      .references(() => users.email, { onDelete: 'cascade' }),
    enrolledAt: timestamp('enrolled_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.courseId, table.studentEmail] }),
    // studentEmail is only the second column of the PK above, so it can't
    // be used as a leading index -- every student-side query filters on it
    // alone.
    index('enrollments_student_email_idx').on(table.studentEmail),
  ],
)

export const courseRoster = pgTable(
  'course_roster',
  {
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    studentId: varchar('student_id').notNull(),
    studentName: varchar('student_name').notNull(),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.courseId, table.studentId] }),
    index('course_roster_course_idx').on(table.courseId),
  ],
)

export const studentDirectory = pgTable(
  'student_directory',
  {
    email: varchar('email').primaryKey(),
    fullName: varchar('full_name').notNull(),
    batch: integer('batch'),
    source: varchar('source').notNull().default('mess-2026-03'),
  },
  (table) => [
    index('student_directory_name_idx').on(table.fullName),
  ],
)

export const classSessions = pgTable(
  'class_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    // HMAC key for this session's rotating tokens. Never leaves the server and
    // is never included in any response -- every query that runs near a client
    // boundary must select columns explicitly rather than selecting the row.
    secret: text('secret').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    rotationSeconds: integer('rotation_seconds').notNull().default(5),
    declaredDisplayCount: integer('declared_display_count').notNull().default(1),
    roomLat: doublePrecision('room_lat'),
    roomLng: doublePrecision('room_lng'),
  },
  (table) => [index('class_sessions_course_idx').on(table.courseId, table.startedAt)],
)

export const displayTokens = pgTable(
  'display_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => classSessions.id, { onDelete: 'cascade' }),
    tokenHash: varchar('token_hash').notNull().unique(),
    // null until first redemption, then pinned. A leaked link is already bound
    // to the podium PC by the time a student could try it.
    pinnedIp: varchar('pinned_ip'),
    issuedByEmail: varchar('issued_by_email')
      .notNull()
      .references(() => users.email),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    // stamped on every poll. "Currently active" is derived from this rather than
    // from a live connection count, because serverless instances share no memory
    // -- same reason SU Connect's rate limiter counts in Postgres.
    lastPingAt: timestamp('last_ping_at', { withTimezone: true }),
  },
  (table) => [index('display_tokens_session_idx').on(table.sessionId)],
)

export const attendanceRecords = pgTable(
  'attendance_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => classSessions.id, { onDelete: 'cascade' }),
    studentEmail: varchar('student_email')
      .notNull()
      .references(() => users.email),
    markedAt: timestamp('marked_at', { withTimezone: true }).notNull().defaultNow(),
    source: attendanceSourceEnum('source').notNull(),
    deviceId: uuid('device_id').references(() => devices.id),
    fingerprint: varchar('fingerprint'),
    ip: varchar('ip'),
    userAgent: text('user_agent'),
    lat: doublePrecision('lat'),
    lng: doublePrecision('lng'),
    accuracy: doublePrecision('accuracy'),
    markedByEmail: varchar('marked_by_email').references(() => users.email),
    reason: text('reason'),
  },
  (table) => [
    // the replay defence: a token is valid for every enrolled student at once,
    // so reuse is prevented per-student rather than per-token
    uniqueIndex('attendance_one_per_student_per_session').on(
      table.sessionId,
      table.studentEmail,
    ),
    index('attendance_fingerprint_idx').on(table.sessionId, table.fingerprint),
  ],
)

export const attendanceFlags = pgTable(
  'attendance_flags',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    recordId: uuid('record_id')
      .notNull()
      .references(() => attendanceRecords.id, { onDelete: 'cascade' }),
    kind: varchar('kind').notNull(),
    detail: jsonb('detail').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('attendance_flags_record_idx').on(table.recordId)],
)

export const reviewRequests = pgTable(
  'review_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => classSessions.id, { onDelete: 'cascade' }),
    studentEmail: varchar('student_email')
      .notNull()
      .references(() => users.email, { onDelete: 'cascade' }),
    reason: text('reason').notNull(),
    status: requestStatusEnum('status').notNull().default('pending'),
    reviewedByEmail: varchar('reviewed_by_email').references(() => users.email),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('review_one_per_student_per_session').on(table.sessionId, table.studentEmail),
  ],
)

export const deviceRebindRequests = pgTable('device_rebind_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  userEmail: varchar('user_email')
    .notNull()
    .references(() => users.email, { onDelete: 'cascade' }),
  reason: text('reason').notNull(),
  status: requestStatusEnum('status').notNull().default('pending'),
  reviewedByEmail: varchar('reviewed_by_email').references(() => users.email),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// Role changes, manual attendance overrides, display-token issuance and
// redemption. Deliberately not cascaded from users: the record of what someone
// did outlives their account.
export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorEmail: varchar('actor_email'),
    action: varchar('action').notNull(),
    subject: varchar('subject'),
    detail: jsonb('detail').$type<Record<string, unknown>>(),
    ip: varchar('ip'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('audit_log_created_idx').on(table.createdAt)],
)
