-- account_profiles: server-side writes only.
--
-- Owners could write every profile column directly through PostgREST,
-- including phone, pending_phone, location_verified_at and
-- legal_name_locked_at (clearing it also unlocks the verified legal name).
-- Admins could unban accounts or change verification status the same way,
-- without the MFA the admin routes require.
--
-- Every profile write now goes through a server route with the service role
-- (profile update, avatar upload, OAuth callback profile creation), so the
-- anon and authenticated roles keep read access only.
--
-- Apply after the app deploy that moves those writes server-side.

BEGIN;

REVOKE INSERT, UPDATE, DELETE ON public.account_profiles FROM anon, authenticated;
DROP POLICY IF EXISTS "Owner creates profile" ON public.account_profiles;
DROP POLICY IF EXISTS "Owner or admin updates profile" ON public.account_profiles;
DROP POLICY IF EXISTS "Admin deletes profile" ON public.account_profiles;

COMMIT;
