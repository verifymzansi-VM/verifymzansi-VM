-- Read-only preflight for updates/20261125150338_admin_removal_needs_approval.sql.
--
-- Run this file unchanged in the Supabase SQL editor before applying the
-- update, and again after it. It changes nothing: the first statement makes
-- the transaction read only, so Postgres refuses any write. The result has one
-- "summary" row, then one row per problem. Apply the update only when the
-- summary is the only row and reads "update not applied".
--
-- The summary says whether internal.propose_frontend_staff_role has the
-- reviewed body (update not applied) or the update's (already applied), and
-- counts the active admins and the staff role changes waiting for approval
-- (of which, removals of an admin).
do $$begin
  set transaction read only;
end$$;
with bodies as (
  select (select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p
    where p.oid = to_regprocedure('internal.propose_frontend_staff_role(text,text,text)')) as body
),
problems as (
  select 'problem' as kind, 'internal.propose_frontend_staff_role(text,text,text) is neither the reviewed body nor the update''s (md5 '
      || coalesce(body, 'missing') || '); do not apply the update' as detail
    from bodies
    where body is distinct from 'd40ad40b7afce00a05ebf599a2953d25'
      and body is distinct from 'e6d446d2702768234f979cdcaa20f281'
)
select 'summary' as kind,
  'admin removal needs approval: '
    || case b.body when 'e6d446d2702768234f979cdcaa20f281' then 'already applied'
         when 'd40ad40b7afce00a05ebf599a2953d25' then 'update not applied'
         else 'unexpected state' end
    || '; active admins: ' || (select count(*) from private.staff_roles r
         where r.role = 'admin' and r.revoked_at is null)
    || '; role changes waiting: ' || (select count(*) from private.frontend_staff_role_changes c
         where c.status = 'proposed' and c.expires_at > statement_timestamp())
    || ' (admin removals: ' || (select count(*) from private.frontend_staff_role_changes c
         where c.status = 'proposed' and c.expires_at > statement_timestamp() and c.from_role = 'admin')
    || ')' as detail
from bodies b
union all
select kind, detail from problems;
