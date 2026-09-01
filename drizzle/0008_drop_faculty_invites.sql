-- Drops the two invite tables 0004 and 0007 added. Faculty access no longer
-- waits for a first sign-in: granting an unknown address now writes its users
-- row with role='faculty' straight away, so there is nothing left to claim.
--
-- The attendance_app grants on these two tables go with them. The users and
-- devices UPDATE grants 0005 added are unrelated and must stay -- the role
-- still needs them to change roles and revoke device bindings.
drop table if exists "course_faculty_invites";--> statement-breakpoint
drop table if exists "faculty_invites";
