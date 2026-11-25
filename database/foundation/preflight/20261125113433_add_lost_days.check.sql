-- Read-only preflight for updates/20261125113433_add_lost_days.sql.
--
-- Run this file unchanged in the Supabase SQL editor before applying the
-- update, and again after it. It changes nothing: the first statement makes
-- the transaction read only, so Postgres refuses any write. The result has one
-- "summary" row, then one row per problem. Apply the update only when the
-- summary is the only row and reads "update not applied".
--
-- The summary says whether internal.frontend_privacy_export_data and
-- internal.slot_package_add_quote have the reviewed bodies and the new table and four new functions are absent (update
-- not applied), or everything is the update's (already applied), and counts:
-- - "running paid grants": paid grants (source retail_paid, active, complete
--   payment) whose end is still in the future, the grants the command moves;
-- - after the update, "additions": rows of the lost days record.
do $$begin
  set transaction read only;
end$$;
with bodies as (
  select v.sig, v.reviewed, v.updated,
    case when v.sig = 'private.lost_day_additions'
      then case when to_regclass('private.lost_day_additions') is not null then 'table' end
      else (select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p where p.oid = to_regprocedure(v.sig))
    end as body
  from (values
    ('internal.frontend_privacy_export_data(uuid)', 'fb567a31cf8ca166f117d5b02f744235', 'b0d8e2600a63b8e5b298ee180f488c05'),
    ('internal.slot_package_add_quote(uuid)', '233e14908c1d2b21b17a9205da371a77', '206dc215863ec39a5fe03bd5dea6fb48'),
    ('private.lost_day_additions', null, 'table'),
    ('internal.get_lost_days_preview(text)', null, '8174b52a62082b35692a7a7237e2d807'),
    ('api.get_lost_days_preview(text)', null, '9aa7df1fa582cd2ef8d13de8d3eb3536'),
    ('internal.add_lost_days(text,integer,text,uuid)', null, '29dd6271b9e19bdaf5c9c7ccc6d42877'),
    ('api.add_lost_days(text,integer,text,uuid)', null, '0e5793d459a7acf45a436a4f3133bfb8')
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
  'lost days: '
    || case when s.updated = s.total then 'already applied'
         when s.reviewed = s.total then 'update not applied'
         else 'unexpected state' end
    || '; running paid grants: ' || (select count(*) from private.entitlements e
         join private.payments pay on pay.id = e.payment_id and pay.status = 'complete'
         where e.source = 'retail_paid' and e.status = 'active' and e.ends_at > statement_timestamp())
    -- The table exists only after the update, so it is read through
    -- query_to_xml, which runs only on this branch.
    || case when s.updated = s.total
         then '; additions: ' || (xpath('/row/n/text()', query_to_xml(
           'select count(*) as n from private.lost_day_additions', false, true, '')))[1]::text
         else '' end as detail
from state s
union all
select kind, detail from problems;
