-- Read-only preflight for updates/20261125194727_part_refund_follow_ups.sql.
--
-- Run this file unchanged in the Supabase SQL editor before applying the
-- update, and again after it. It changes nothing: the first statement makes
-- the transaction read only, so Postgres refuses any write. The result has one
-- "summary" row, then one row per problem. Apply the update only when the
-- summary is the only row and reads "update not applied", and only after the
-- website of the update's pull request is deployed (website-first).
--
-- The summary says whether internal.payment_refunded_before_cents,
-- internal.record_staff_refund, internal.get_staff_refunds_left and
-- internal.get_lost_days_preview have their reviewed bodies (update not
-- applied) or this update's (already applied), and counts:
-- - "part refunds keeping the slot running": refund records that kept the
--   paid days (information);
-- - "of them on payments not activated": such records on a payment still
--   waiting for "Activate what was paid for" (the update refuses new ones;
--   expected 0);
-- - "slots reversed after one": reversed slots whose only applied refund
--   record kept the slot running (what was refunded now counts them).
do $$begin
  set transaction read only;
end$$;
with bodies as (
  select v.sig, v.reviewed, v.updated,
    coalesce((select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p where p.oid = to_regprocedure(v.sig)),
      'absent') as body
  from (values
    ('internal.payment_refunded_before_cents(uuid)',
      'edcb14caf62c8375f0216d828ecc276d', '2c0d95fd340de5cdeb5bd1822e9328f0'),
    ('internal.record_staff_refund(uuid,uuid,text,bigint,text,text,text,jsonb,text,uuid)',
      'ec6a4f471dc46d6c6c31338f10de07bf', 'b19dc0eb2d6059d45a2d4dc1e41509c3'),
    ('internal.get_staff_refunds_left(uuid[])',
      '5df1c510531ea6e328ca33cba01e0b9f', '213b445867763f0f1d33c3b58a4d432a'),
    ('internal.get_lost_days_preview(text)',
      '8174b52a62082b35692a7a7237e2d807', '28911037e70036c47131c49994740942')
  ) v(sig, reviewed, updated)
),
state as (
  select bool_and(body = reviewed) as absent, bool_and(body = updated) as applied from bodies
),
kept as (
  select r.* from private.payment_refund_requests r where not r.ends_paid_days
),
problems as (
  select 'problem' as kind,
    sig || ' is neither the reviewed body nor the update''s (md5 ' || body || '); do not apply the update' as detail
  from bodies where body <> reviewed and body <> updated
)
select 'summary' as kind,
  'part refund follow-ups: '
    || case when s.applied then 'already applied'
         when s.absent then 'update not applied'
         else 'unexpected state' end
    || '; part refunds keeping the slot running: ' || (select count(*) from kept)
    || '; of them on payments not activated: '
    || (select count(*) from kept k join private.payments p on p.id = k.payment_id
         where p.fulfillment_status <> 'fulfilled')
    || '; slots reversed after one: '
    || (select count(*) from private.payment_lines l where l.status = 'reversed'
         and exists(select 1 from kept k where k.status = 'applied' and k.payment_id = l.payment_id
           and (k.payment_line_id = l.id or k.payment_line_id is null))
         and not exists(select 1 from private.payment_refund_requests r where r.status = 'applied'
           and r.ends_paid_days and r.payment_id = l.payment_id
           and (r.payment_line_id = l.id or r.payment_line_id is null))) as detail
from state s
union all
select kind, detail from problems;
