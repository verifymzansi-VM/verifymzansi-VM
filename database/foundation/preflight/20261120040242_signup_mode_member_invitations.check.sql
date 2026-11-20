-- Read-only preflight for updates/20261120040242_signup_mode_member_invitations.sql.
--
-- Run this file unchanged in the Supabase SQL editor before applying the
-- update, and again after it. It changes nothing: the first statement makes
-- the transaction read only, so Postgres refuses any write. The result has one
-- "summary" row, then one row per problem. Apply the update only when the
-- summary is the only row and reads "update not applied".
--
-- The summary says whether the update's tables and functions are all absent
-- (update not applied), all present (already applied, with the sign-up mode
-- and counts) or partly present (unexpected state). In both states it gives
-- the number of administrator invitations not yet used: each of those
-- addresses becomes an administrator when its account enrols an authenticator
-- app, so revoke any that were meant for an ordinary member and invite that
-- person as a member instead. A problem row names a function the update
-- replaces whose body is neither the reviewed one nor the update's.
do $$begin
  set transaction read only;
end$$;
with objects as (
  select v.name, v.present
  from (values
    ('private.signup_settings', to_regclass('private.signup_settings') is not null),
    ('private.signup_mode_events', to_regclass('private.signup_mode_events') is not null),
    ('private.member_invitations', to_regclass('private.member_invitations') is not null),
    ('private.signup_blocked_domains', to_regclass('private.signup_blocked_domains') is not null),
    ('internal.signup_settings_guard()', to_regprocedure('internal.signup_settings_guard()') is not null),
    ('internal.set_signup_mode(text,text,text)',
      to_regprocedure('internal.set_signup_mode(text,text,text)') is not null),
    ('internal.get_signup_mode()', to_regprocedure('internal.get_signup_mode()') is not null),
    ('api.get_signup_mode()', to_regprocedure('api.get_signup_mode()') is not null),
    ('internal.invite_member(text)', to_regprocedure('internal.invite_member(text)') is not null),
    ('api.invite_member(text)', to_regprocedure('api.invite_member(text)') is not null),
    ('internal.revoke_member_invitation(text)',
      to_regprocedure('internal.revoke_member_invitation(text)') is not null),
    ('api.revoke_member_invitation(text)',
      to_regprocedure('api.revoke_member_invitation(text)') is not null),
    ('internal.list_member_invitations()',
      to_regprocedure('internal.list_member_invitations()') is not null),
    ('api.list_member_invitations()', to_regprocedure('api.list_member_invitations()') is not null),
    ('internal.purge_member_invitations(integer)',
      to_regprocedure('internal.purge_member_invitations(integer)') is not null)
  ) v(name, present)
),
state as (
  select bool_and(not present) as absent, bool_and(present) as applied from objects
),
bodies as (
  select v.sig, coalesce((select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p
      where p.oid = to_regprocedure(v.sig)), 'absent') as body, v.reviewed, v.updated
  from (values
    ('internal.acceptance_signup_guard(jsonb)', '6afecd39f7374ea9f67f2c39d56d3c9b',
      '0dd79427b2bd0772a041efeadef893d0'),
    ('internal.run_retention(integer)', '06a3fbfcb5b2d53e2487719174a62cc5',
      '95dda89b3f540a74110a0ca1eba02e66')
  ) v(sig, reviewed, updated)
),
admin_invitations as (
  select count(*) filter (where i.claimed_at is null and i.revoked_at is null) as unused
  from private.owner_admin_invitations i
),
problems as (
  select 'problem' as kind,
    name || ' is ' || case when present then 'present' else 'missing' end
      || ' while other parts of the update are not; do not apply the update' as detail
  from objects, state
  where not state.absent and not state.applied
  union all
  select 'problem',
    sig || ' is not the reviewed body (' || body || '); do not apply the update'
  from bodies
  where body not in (reviewed, updated)
)
select 'summary' as kind,
  'signup mode and member invitations: '
    || case when s.applied then 'already applied; mode: '
           -- Read by name at run time: the tables do not exist before the update.
           || coalesce((xpath('/row/m/text()', query_to_xml(
                'select mode as m from private.signup_settings where id', false, true, '')))[1]::text,
                'missing (the hook treats it as invite_only)')
           || '; mode changes recorded: '
           || (xpath('/row/n/text()', query_to_xml(
                'select count(*) as n from private.signup_mode_events', false, true, '')))[1]::text
           || '; member invitations open: '
           || (xpath('/row/n/text()', query_to_xml(
                'select count(*) as n from private.member_invitations where revoked_at is null and expires_at > statement_timestamp()',
                false, true, '')))[1]::text
           || '; blocked domains: '
           || (xpath('/row/n/text()', query_to_xml(
                'select count(*) as n from private.signup_blocked_domains', false, true, '')))[1]::text
           || '; '
         when s.absent then 'update not applied; '
         else 'unexpected state; ' end
    || 'administrator invitations not yet used: ' || a.unused as detail
from state s, admin_invitations a
union all
select kind, detail from problems;
