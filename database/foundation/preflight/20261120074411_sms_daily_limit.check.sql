-- Read-only preflight for updates/20261120074411_sms_daily_limit.sql.
--
-- Run this file unchanged in the Supabase SQL editor before applying the
-- update, and again after it. It changes nothing: the first statement makes
-- the transaction read only, so Postgres refuses any write. The result has one
-- "summary" row, then one row per problem. Apply the update only when the
-- summary is the only row and reads "update not applied".
--
-- The summary says whether internal.create_verification_phone_challenge is the
-- reviewed body and the table, the setting and the helper are absent (update
-- not applied), or everything is the update's (already applied), and counts:
-- - "codes today": phone challenges stored since midnight South African time
--   (each was one SMS code);
-- - after the update, "counted today": the day's count the limit uses (equal
--   to "codes today" right after applying), and "limit": the setting.
do $$begin
  set transaction read only;
end$$;
with bodies as (
  select v.sig, v.reviewed, v.updated,
    (select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p where p.oid = to_regprocedure(v.sig)) as body
  from (values
    ('internal.create_verification_phone_challenge(uuid,text,text)',
      '3661274c4f3c00f87490dd4be0809820', '635dd87998cdbdb31dcb4fb20e8ef202'),
    ('internal.sms_daily_limit()', null, 'ddff17b83ea8ab070423ea21ca7436f2')
  ) v(sig, reviewed, updated)
),
shape as (
  select to_regclass('private.sms_code_days') is not null as has_table,
    exists (select 1 from private.cost_allowances a where a.metric = 'sms_codes_day') as has_setting
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
  select 'problem', 'only part of the update is present'
    from state, shape
    where not exists (select 1 from bodies where body is distinct from reviewed and body is distinct from updated)
      and not ((reviewed = total and not has_table and not has_setting)
        or (updated = total and has_table and has_setting))
),
today as (
  select (statement_timestamp() at time zone 'Africa/Johannesburg')::date as day
)
select 'summary' as kind,
  'sms daily limit: '
    || case when s.updated = s.total and sh.has_table and sh.has_setting then 'already applied'
         when s.reviewed = s.total and not sh.has_table and not sh.has_setting then 'update not applied'
         else 'unexpected state' end
    || '; codes today: ' || (select count(*) from private.verification_phone_challenges c, today t
         where c.created_at >= t.day::timestamp at time zone 'Africa/Johannesburg')
    -- The table and the helper exist only after the update, so they are read
    -- through query_to_xml, which runs only on this branch.
    || case when sh.has_table and sh.has_setting and s.updated = s.total
         then '; counted today: ' || coalesce((xpath('/row/n/text()', query_to_xml(
             'select d.sent as n from private.sms_code_days d'
             || ' where d.day = (statement_timestamp() at time zone ''Africa/Johannesburg'')::date',
             false, true, '')))[1]::text, '0')
           || '; limit: ' || (xpath('/row/n/text()', query_to_xml(
             'select internal.sms_daily_limit() as n', false, true, '')))[1]::text
         else '' end as detail
from state s, shape sh
union all
select kind, detail from problems;
