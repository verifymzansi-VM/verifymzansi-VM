-- Read-only preflight for updates/20261127222829_close_unused_commands.sql.
--
-- Run this file unchanged in the Supabase SQL editor before applying the
-- update, and again after it. It changes nothing: the first statement makes
-- the transaction read only, so Postgres refuses any write. The result has one
-- "summary" row, then one row per problem. Apply the update only when the
-- summary is the only row and reads "update not applied".
--
-- Before: the eleven functions the update drops exist, the five internal
-- functions it keeps are executable by authenticated, and the staff role
-- review has its reviewed body. After: none of the eleven exist, the five are
-- not executable by authenticated, and the role review has the update's body.
do $$begin
  set transaction read only;
end$$;
with dropped(sig) as (
  values
    ('api.execute_frontend_report_action(uuid,integer,text,uuid,text,text,integer,boolean)'),
    ('api.get_my_frontend_posting_allowance(text)'),
    ('api.get_frontend_report_queue(text)'),
    ('api.list_my_frontend_notifications(integer,boolean,timestamptz)'),
    ('api.get_frontend_seen_queue(text)'),
    ('api.get_my_frontend_business_checks(uuid)'),
    ('api.release_frontend_content_hold(uuid,integer,text)'),
    ('api.open_identity_disclosure(text,text,text,text,text,boolean)'),
    ('internal.get_my_frontend_posting_allowance(text)'),
    ('internal.list_my_frontend_notifications(integer,boolean,timestamptz)'),
    ('internal.open_identity_disclosure(text,text,text,text,text,boolean)')
),
kept(sig) as (
  values
    ('internal.execute_frontend_report_action(uuid,integer,text,uuid,text,text,integer,boolean)'),
    ('internal.get_frontend_report_queue(text)'),
    ('internal.get_frontend_seen_queue(text)'),
    ('internal.get_my_frontend_business_checks(uuid)'),
    ('internal.release_frontend_content_hold(uuid,integer,text)')
),
review as (
  select (select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p
    where p.oid = to_regprocedure('internal.get_frontend_staff_role_review(integer,text)')) as body,
    'f2d542319179e14457c863d7392e7dd3' as reviewed, '6e80f5cf89c78c9032bd42c3f2632ef4' as updated
),
kept_state as (
  select k.sig, to_regprocedure(k.sig) is not null as present,
    to_regprocedure(k.sig) is not null
      and has_function_privilege('authenticated', to_regprocedure(k.sig), 'execute') as granted
  from kept k
),
state as (
  select (select count(*) from dropped d where to_regprocedure(d.sig) is not null) as dropped_present,
    (select count(*) from kept_state where granted) as kept_granted,
    r.body, r.reviewed, r.updated
  from review r
),
problems as (
  select 'problem' as kind, sig || ' is missing; do not apply the update' as detail
    from kept_state where not present
  union all
  select 'problem', 'internal.get_frontend_staff_role_review is neither the reviewed body nor the update''s (md5 '
      || coalesce(body, 'missing') || '); do not apply the update'
    from state where body is distinct from reviewed and body is distinct from updated
)
select 'summary' as kind,
  'close unused commands: '
    || case when s.dropped_present = 11 and s.kept_granted = 5 and s.body = s.reviewed then 'update not applied'
         when s.dropped_present = 0 and s.kept_granted = 0 and s.body = s.updated then 'already applied'
         else 'unexpected state' end
    || '; functions to drop present: ' || s.dropped_present || ' of 11'
    || '; kept internal functions executable by authenticated: ' || s.kept_granted || ' of 5' as detail
from state s
union all
select kind, detail from problems;
