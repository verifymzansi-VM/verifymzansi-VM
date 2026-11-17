-- Read-only preflight for updates/20261113085340_retire_old_staff_reversal_commands.sql.
--
-- Run this file unchanged in the Supabase SQL editor before applying the
-- update, and again after it. It changes nothing: the first statement makes
-- the transaction read only, so Postgres refuses any write. The result has one
-- "summary" row, then one row per problem. Apply the update only when the
-- summary is the only row and reads "update not applied".
--
-- The summary says whether the update is absent (the three earlier API
-- commands are present and signed-in callers may run them and the three
-- internal functions behind them) or applied (the three commands are gone and
-- no API role may run the internal functions), and counts the refunds waiting
-- for a second staff member (the update leaves them unchanged). A
-- problem row is shown when 20261113021223_staff_payment_fixes.sql is not
-- applied with its reviewed bodies (this update needs its replacement
-- commands) or when an earlier command is not its reviewed wrapper.
do $$begin
  set transaction read only;
end$$;
with replacements as (
  select v.sig, v.reviewed,
    (select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p where p.oid = to_regprocedure(v.sig)) as body
  from (values
    ('api.get_staff_payment_list(integer,text)', 'a96efb8aa9552502327936ecf4e05d5f'),
    ('api.record_staff_payment_refund(uuid,text,text,text,text)', 'c88c371f4398b69da822669fe832dac9'),
    ('api.record_staff_slot_refund(uuid,text,text,text,text)', '74bae46217113296da99631b7a316e76'),
    ('api.approve_staff_payment_refund(uuid)', 'c940eeb3f76b9bdd82e4377909b97cc0'),
    ('api.decline_staff_payment_refund(uuid,text)', 'e05112535fb4c6e13589f4f339a74dec'),
    ('api.activate_staff_paid_payment(uuid,text)', '38ff2863e1c58cd9cb7d6dd22636ad10'),
    ('internal.record_staff_slot_refund(uuid,text,text,text,text)', 'a315072d628da2b6f164491cbc1a0076'),
    ('internal.approve_staff_payment_refund(uuid)', 'f757a5e1ac7aa4a199dbcd05f5465083')
  ) v(sig, reviewed)
),
retired as (
  select v.sig, v.reviewed,
    (select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p where p.oid = to_regprocedure(v.sig)) as body
  from (values
    ('api.record_frontend_staff_payment_reversal(uuid,text,text)', 'aabd8d6fa4192d2930525de072064479'),
    ('api.record_staff_slot_reversal(uuid,text,text)', '2a52fbde1bcd5076472a92751af0bedb'),
    ('api.get_frontend_staff_payments(integer,text)', '36df30d37390ab583f50bca554a1dfaa')
  ) v(sig, reviewed)
),
closed as (
  select v.sig, to_regprocedure(v.sig) is not null as present,
    coalesce((select bool_or(has_function_privilege(r.rolname, to_regprocedure(v.sig), 'execute'))
      from (values ('anon'), ('authenticated'), ('service_role')) r(rolname)
      where to_regprocedure(v.sig) is not null), false) as callable
  from (values
    ('internal.record_frontend_staff_payment_reversal(uuid,text,text)'),
    ('internal.get_frontend_staff_payments(integer,text)'),
    ('internal.record_staff_slot_reversal(uuid,text,text)')
  ) v(sig)
),
state as (
  select
    (select count(*) from retired where body is not null)
      + (select count(*) from closed where callable) as absent,
    (select count(*) from retired where body is null)
      + (select count(*) from closed where present and not callable) as updated,
    (select count(*) from retired) + (select count(*) from closed) as total
),
problems as (
  select 'problem' as kind, sig || ' is not the reviewed body of 20261113021223_staff_payment_fixes.sql (md5 '
      || coalesce(body, 'missing') || '); apply that update first' as detail
    from replacements where body is distinct from reviewed
  union all
  select 'problem', sig || ' is not the reviewed wrapper (md5 ' || body || '); review it before removing it'
    from retired where body is not null and body <> reviewed
  union all
  select 'problem', sig || ' is missing'
    from closed where not present
  union all
  select 'problem', 'only part of the update is present'
    from state where absent <> total and updated <> total
      and not exists (select 1 from closed where not present)
)
select 'summary' as kind,
  'retire old staff reversal commands: '
    || case when s.updated = s.total then 'already applied'
         when s.absent = s.total then 'update not applied'
         else 'unexpected state' end
    || '; refunds waiting for approval: '
    || case when to_regclass('private.payment_refund_requests') is null then 'none (table absent)'
         else (xpath('/row/n/text()', query_to_xml(
           'select count(*) as n from private.payment_refund_requests where status = ''awaiting_approval''',
           false, true, '')))[1]::text
       end as detail
from state s
union all
select kind, detail from problems;
