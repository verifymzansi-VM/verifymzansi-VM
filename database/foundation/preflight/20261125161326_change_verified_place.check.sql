-- Read-only preflight for updates/20261125161326_change_verified_place.sql.
--
-- Run this file unchanged in the Supabase SQL editor before applying the
-- update, and again after it. It changes nothing: the first statement makes
-- the transaction read only, so Postgres refuses any write. The result has one
-- "summary" row, then one row per problem. Apply the update only when the
-- summary is the only row and reads "update not applied".
--
-- The summary says whether internal.confirm_verification_locality and
-- internal.frontend_privacy_export_data have the reviewed bodies and the new
-- table is absent (update not applied), or everything is the update's
-- (already applied), and counts:
-- - "members with a place": rows of private.verification_localities;
-- - after the update, "place changes": rows of the change record.
do $$begin
  set transaction read only;
end$$;
with bodies as (
  select v.sig, v.reviewed, v.updated,
    case when v.sig = 'private.verification_locality_changes'
      then case when to_regclass('private.verification_locality_changes') is not null then 'table' end
      else (select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p where p.oid = to_regprocedure(v.sig))
    end as body
  from (values
    ('internal.confirm_verification_locality(text,text)', '0431a9726c90edf0f0b6519a4af17ff6', 'c32f46a4b6f62223a0dce0d6701048dc'),
    ('internal.frontend_privacy_export_data(uuid)', 'b0d8e2600a63b8e5b298ee180f488c05', '0ddcef84e7abeef43fa2509a31d6a298'),
    ('private.verification_locality_changes', null, 'table')
  ) v(sig, reviewed, updated)
),
state as (
  select
    count(*) filter (where body is not distinct from reviewed) as reviewed,
    count(*) filter (where body = updated) as updated,
    count(*) as total
  from bodies
),
problems as (
  select 'problem' as kind, sig || ' is neither the reviewed body nor the update''s (md5 '
      || coalesce(body, 'missing') || '); do not apply the update' as detail
    from bodies where body is distinct from reviewed and body is distinct from updated
  union all
  select 'problem', 'only part of the update is present'
    from state
    where not exists (select 1 from bodies where body is distinct from reviewed and body is distinct from updated)
      and reviewed <> total and updated <> total
)
select 'summary' as kind,
  'verified place: '
    || case when s.updated = s.total then 'already applied'
         when s.reviewed = s.total then 'update not applied'
         else 'unexpected state' end
    || '; members with a place: ' || (select count(*) from private.verification_localities)
    -- The table exists only after the update, so it is read through
    -- query_to_xml, which runs only on this branch.
    || case when s.updated = s.total
         then '; place changes: ' || (xpath('/row/n/text()', query_to_xml(
           'select count(*) as n from private.verification_locality_changes', false, true, '')))[1]::text
         else '' end as detail
from state s
union all
select kind, detail from problems;
