-- Privileges for the tables 0004_faculty_invites added, and for the writes the
-- faculty-access screen performs.
--
-- Production runs as attendance_app, a role with table-level grants and no
-- ownership, created by the parked 0004_security_hardening/0005_privacy work.
-- That role's grants were written before faculty_invites existed, so the table
-- arrived with no privileges on it at all -- and claimFacultyInvite() reads it
-- on *every* sign-in, so this was not confined to /admin/faculty: it broke
-- logging in.
--
-- users.UPDATE is here for the same reason. The original grant list gave the
-- role SELECT and INSERT only, which was enough while roles were changed by a
-- script connecting as postgres, and stopped being enough the moment an admin
-- could change them from the UI. devices.UPDATE covers revoking a binding on
-- rebind.
--
-- Guarded so this is a no-op on databases that never got the runtime role --
-- the local embedded Postgres, and any fresh checkout.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'attendance_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.faculty_invites TO attendance_app;
    GRANT UPDATE ON TABLE public.users TO attendance_app;
    GRANT UPDATE ON TABLE public.devices TO attendance_app;
  END IF;
END
$$;
