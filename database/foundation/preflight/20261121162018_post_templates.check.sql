-- Read-only preflight for updates/20261121162018_post_templates.sql.
--
-- Run this file unchanged in the Supabase SQL editor before applying the
-- update, and again after it. It changes nothing: the first statement makes
-- the transaction read only, so Postgres refuses any write. The result has one
-- "summary" row, then one row per problem. Apply the update only when the
-- summary is the only row and reads "update not applied".
--
-- The summary says whether internal.frontend_privacy_export_data is the
-- reviewed body and the new table and nine new functions are absent (update
-- not applied), or everything is the update's (already applied), and counts
-- "slot packages" (Multi-listing packages ever bought) and, after the update,
-- "templates" and the "accounts with templates".
do $$begin
  set transaction read only;
end$$;
with bodies as (
  select v.sig, v.reviewed, v.updated,
    case when v.sig = 'private.post_templates'
      then case when to_regclass('private.post_templates') is not null then 'table' end
      else (select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p where p.oid = to_regprocedure(v.sig))
    end as body
  from (values
    ('internal.frontend_privacy_export_data(uuid)', 'e543b105fe264d5a683b5c570bf68cb5', 'ab02f76bb5bb62b58521df6d584cf93b'),
    ('private.post_templates', null, 'table'),
    ('internal.save_my_post_template(text,jsonb)', null, '3100f052478a97422f57d031ae36d158'),
    ('api.save_my_post_template(text,jsonb)', null, '7b7c38ccb53d847bdbf5fbb5c7ac6ff2'),
    ('internal.list_my_post_templates()', null, '4ffe9bdfc9c0b380f2b6e59c0f8efa88'),
    ('api.list_my_post_templates()', null, 'f85908247e26dadcc725375bc1679bae'),
    ('internal.rename_my_post_template(uuid,text)', null, 'a94351e00965b9c1e889f93fb4143d3b'),
    ('api.rename_my_post_template(uuid,text)', null, 'b40de85a9040f0f014d4190312f817ad'),
    ('internal.delete_my_post_template(uuid)', null, 'ebfc6a0e2486f3b78df0aff1542f96c8'),
    ('api.delete_my_post_template(uuid)', null, '574ff2124c9b9cffe12c02ef79b6261d'),
    ('internal.clear_closed_account_post_templates()', null, 'c11685ff656cdf41c28ed8d0e6ed4b71')
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
  'post templates: '
    || case when s.updated = s.total then 'already applied'
         when s.reviewed = s.total then 'update not applied'
         else 'unexpected state' end
    || '; slot packages: ' || (select count(*) from private.slot_packages)
    -- The table exists only after the update, so it is read through
    -- query_to_xml, which runs only on this branch.
    || case when s.updated = s.total
         then '; templates: ' || (xpath('/row/n/text()', query_to_xml(
             'select count(*) as n from private.post_templates', false, true, '')))[1]::text
           || '; accounts with templates: ' || (xpath('/row/n/text()', query_to_xml(
             'select count(distinct owner_id) as n from private.post_templates', false, true, '')))[1]::text
         else '' end as detail
from state s
union all
select kind, detail from problems;
