-- Read-only preflight for updates/20261122130744_free_credits.sql.
--
-- Run this file unchanged in the Supabase SQL editor before applying the
-- update, and again after it. It changes nothing: the first statement makes
-- the transaction read only, so Postgres refuses any write. The result has one
-- "summary" row, then one row per problem. Apply the update only when the
-- summary is the only row and reads "update not applied".
--
-- The summary says whether internal.get_my_frontend_post_manager is the
-- reviewed body and the new table and six new functions are absent (update
-- not applied), or everything is the update's (already applied), and counts:
-- - "entitlements": every entitlement (slot) on record;
-- - after the update, "gifts": entitlements with the source free_credit,
--   "active" those still running, and "events": rows of the gift record.
do $$begin
  set transaction read only;
end$$;
with bodies as (
  select v.sig, v.reviewed, v.updated,
    case when v.sig = 'private.free_credit_events'
      then case when to_regclass('private.free_credit_events') is not null then 'table' end
      else (select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p where p.oid = to_regprocedure(v.sig))
    end as body
  from (values
    ('internal.get_my_frontend_post_manager()', 'c408ccd9ee1a2cc4f135f2b4032f6583', 'bf4e28d6a385e6823983ccb93f7315ad'),
    ('private.free_credit_events', null, 'table'),
    ('internal.give_free_credit(text,integer,integer,text)', null, 'e883d90c03704304dec1321f365c0f0a'),
    ('api.give_free_credit(text,integer,integer,text)', null, 'a18653758dbfb3177404bd8b083115da'),
    ('internal.extend_free_credit(uuid,integer,text)', null, 'f932cc79bb3bda5fa606fad58d94e53b'),
    ('api.extend_free_credit(uuid,integer,text)', null, '19c0634bbd5418e3eca8e2fb4032f166'),
    ('internal.list_free_credits()', null, '3844d1a2876105f451a5267503380582'),
    ('api.list_free_credits()', null, 'ef063d6b12ce7a9b30af3af33d792cfe')
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
  union all
  select 'problem', 'an entitlement already has the source free_credit before the update; do not apply the update'
    from state s
    where s.updated <> s.total and exists (select 1 from private.entitlements e where e.source = 'free_credit')
)
select 'summary' as kind,
  'free credits: '
    || case when s.updated = s.total then 'already applied'
         when s.reviewed = s.total then 'update not applied'
         else 'unexpected state' end
    || '; entitlements: ' || (select count(*) from private.entitlements)
    -- The table exists only after the update, so it is read through
    -- query_to_xml, which runs only on this branch.
    || case when s.updated = s.total
         then '; gifts: ' || (select count(*) from private.entitlements e where e.source = 'free_credit')
           || ' (active: ' || (select count(*) from private.entitlements e where e.source = 'free_credit'
             and e.status = 'active' and e.ends_at > statement_timestamp()) || ')'
           || '; events: ' || (xpath('/row/n/text()', query_to_xml(
             'select count(*) as n from private.free_credit_events', false, true, '')))[1]::text
         else '' end as detail
from state s
union all
select kind, detail from problems;
