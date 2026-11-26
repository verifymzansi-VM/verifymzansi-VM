-- Read-only preflight for updates/20261126001811_staff_access_follow_ups.sql.
--
-- Run this file unchanged in the Supabase SQL editor before applying the
-- update, and again after it. It changes nothing: the first statement makes
-- the transaction read only, so Postgres refuses any write. The result has one
-- "summary" row, then one row per problem. Apply the update only when the
-- summary is the only row and reads "update not applied".
--
-- The summary says whether internal.claim_owner_admin_invitation and
-- internal.close_account_evidence have their reviewed bodies (update not
-- applied) or the update's (already applied), and counts the active admins,
-- the waiting owner admin invitations, those of them whose account already has
-- a verified authenticator app (the update does not claim these: if this is
-- above 0, ask the owner, then delete and add each such invitation again, see
-- updates/README.md), and accounts with an active staff role that are already
-- closed (expected 0).
do $$begin
  set transaction read only;
end$$;
with bodies as (
  select
    (select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p
      where p.oid = to_regprocedure('internal.claim_owner_admin_invitation()')) as claim,
    (select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p
      where p.oid = to_regprocedure('internal.close_account_evidence(uuid)')) as close
),
state as (
  select b.*,
    case when b.claim = 'aad6e9487ca76eba953086e5054fad11' and b.close = '1b447b3fe8805138814c3cdb0ceb6daa'
           then 'already applied'
         when b.claim = '9b58d1999a5babe02f2ab051cb79bcce' and b.close = 'ae0f20403df41b820bad1c96d93a0be1'
           then 'update not applied'
         else 'unexpected state' end as status
  from bodies b
),
waiting as (
  select i.email, i.signed_up_at, i.signed_up_by from private.owner_admin_invitations i
  where i.claimed_at is null and i.revoked_at is null
),
problems as (
  select 'problem' as kind, 'internal.claim_owner_admin_invitation() is neither the reviewed body nor the update''s (md5 '
      || coalesce(claim, 'missing') || '); do not apply the update' as detail
    from state
    where claim is distinct from '9b58d1999a5babe02f2ab051cb79bcce'
      and claim is distinct from 'aad6e9487ca76eba953086e5054fad11'
  union all
  select 'problem', 'internal.close_account_evidence(uuid) is neither the reviewed body nor the update''s (md5 '
      || coalesce(close, 'missing') || '); do not apply the update'
    from state
    where close is distinct from 'ae0f20403df41b820bad1c96d93a0be1'
      and close is distinct from '1b447b3fe8805138814c3cdb0ceb6daa'
)
select 'summary' as kind,
  'staff access follow-ups: ' || s.status
    || '; active admins: ' || (select count(*) from private.staff_roles r
         where r.role = 'admin' and r.revoked_at is null)
    || '; admin invitations waiting: ' || (select count(*) from waiting)
    || ' (account already has an authenticator app: ' || (select count(*) from waiting w
         where exists (select 1 from auth.users u join auth.mfa_factors f on f.user_id = u.id
           where lower(u.email) = w.email and (w.signed_up_at is null or u.id = w.signed_up_by)
             and f.factor_type = 'totp' and f.status = 'verified'))
    || '); closed accounts with a staff role: ' || (select count(*) from private.staff_roles r
         join private.account_closures c on c.user_id = r.user_id where r.revoked_at is null) as detail
from state s
union all
select kind, detail from problems;
