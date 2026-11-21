-- Read-only preflight for updates/20261121043124_identity_record_disclosure.sql.
--
-- Run this file unchanged in the Supabase SQL editor before applying the
-- update, and again after it. It changes nothing: the first statement makes
-- the transaction read only, so Postgres refuses any write. The result has one
-- "summary" row, then one row per problem. Apply the update only when the
-- summary is the only row and reads "update not applied".
--
-- The summary says whether internal.staff_actor and internal.append_only_guard
-- are the reviewed bodies, the staff audit trail is the reviewed view and the
-- disclosure logs and commands are absent (update not applied), or everything
-- is the update's (already applied), and counts:
-- - "governors and admins": current staff roles that will hold (or hold) the
--   new capability identity:disclose;
-- - after the update, "disclosures": rows in private.identity_disclosures.
do $$begin
  set transaction read only;
end$$;
with bodies as (
  select v.sig, v.reviewed, v.updated,
    (select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p where p.oid = to_regprocedure(v.sig)) as body
  from (values
    ('internal.staff_actor(text)',
      '269f0871f156f57c029cedcab72f6c3f', '269f0871f156f57c029cedcab72f6c3f'),
    ('internal.append_only_guard()',
      'dfac5657b00f4d86a399e04e44d2ea59', 'dfac5657b00f4d86a399e04e44d2ea59')
  ) v(sig, reviewed, updated)
),
shape as (
  select (to_regclass('private.identity_disclosures') is not null)::integer
    + (to_regclass('private.identity_disclosure_events') is not null)::integer
    + (to_regprocedure('api.open_identity_disclosure(text,text,text,text,text,text,text,boolean)') is not null)::integer
    + (to_regprocedure('api.read_identity_disclosure(uuid,text,uuid)') is not null)::integer
    + (to_regprocedure('api.close_identity_disclosure(uuid)') is not null)::integer
    + (to_regprocedure('api.list_identity_disclosures()') is not null)::integer
    + (to_regprocedure('api.identity_disclosure_material(uuid,uuid)') is not null)::integer
    as present,
    coalesce(pg_get_viewdef('private.frontend_staff_audit_events'::regclass) like '%customer_invoice_voided%', false) as view_reviewed,
    coalesce(pg_get_viewdef('private.frontend_staff_audit_events'::regclass) like '%identity_disclosure%', false) as view_updated
),
state as (
  select
    count(*) filter (where body is not distinct from reviewed) as reviewed,
    count(*) filter (where body = updated) as updated,
    count(*) as total
  from bodies
),
problems as (
  select 'problem' as kind, sig || ' is not the reviewed body (md5 ' || coalesce(body, 'missing') || '); do not apply the update' as detail
    from bodies where body is distinct from reviewed and body is distinct from updated
  union all
  select 'problem', 'private.frontend_staff_audit_events is not the reviewed view; do not apply the update'
    from shape where not view_reviewed
  union all
  select 'problem', 'only part of the update is present'
    from state, shape
    where not exists (select 1 from bodies where body is distinct from reviewed and body is distinct from updated)
      and view_reviewed
      and not ((reviewed = total and present = 0 and not view_updated)
        or (updated = total and present = 7 and view_updated))
)
select 'summary' as kind,
  'identity record disclosure: '
    || case when s.updated = s.total and sh.present = 7 and sh.view_reviewed and sh.view_updated then 'already applied'
         when s.reviewed = s.total and sh.present = 0 and sh.view_reviewed and not sh.view_updated then 'update not applied'
         else 'unexpected state' end
    || '; governors and admins: ' || (select count(*) from private.staff_roles r
         where r.revoked_at is null and r.role in ('governor', 'admin'))
    -- The table exists only after the update, so it is read through
    -- query_to_xml, which runs only on this branch.
    || case when sh.present = 7 and s.updated = s.total
         then '; disclosures: ' || (xpath('/row/n/text()', query_to_xml(
             'select count(*) as n from private.identity_disclosures', false, true, '')))[1]::text
         else '' end as detail
from state s, shape sh
union all
select kind, detail from problems;
