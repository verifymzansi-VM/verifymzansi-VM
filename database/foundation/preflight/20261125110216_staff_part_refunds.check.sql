-- Read-only preflight for updates/20261125110216_staff_part_refunds.sql.
--
-- Run this file unchanged in the Supabase SQL editor before applying the
-- update, and again after it. It changes nothing: the first statement makes
-- the transaction read only, so Postgres refuses any write. The result has one
-- "summary" row, then one row per problem. Apply the update only when the
-- summary is the only row and reads "update not applied".
--
-- The summary says whether the five functions the update replaces have the
-- reviewed earlier bodies and the twelve it adds are absent (update not
-- applied), the update's bodies (already applied), or a mix (unexpected
-- state), and counts, for staff to look at (none of them stops the update):
-- - "waiting for approval": refund records waiting for a second staff member;
-- - "through Ozow not sent": approved refunds through Ozow the server has not
--   sent yet;
-- - "part refunds": refund records for less than the whole payment or slot
--   (0 before the update; after it, the part refunds recorded since).
do $$begin
  set transaction read only;
end$$;
with bodies as (
  select v.sig, v.reviewed, v.updated,
    coalesce((select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p where p.oid = to_regprocedure(v.sig)), 'absent') as body
  from (values
    ('internal.payment_refund_request_guard()',
      '11b86b7a627aad245c84433118601705', '9e8a87d429606cdd7c092cee4ba695ba'),
    ('internal.payment_net_cents(private.payments)',
      '28d85be00f5d30c0f2121b120ea55dc9', '237b3d0054e49f02f2da9cd227d5c789'),
    ('internal.approve_staff_payment_refund(uuid)',
      '189b3f24e9b847bf75760eeaae9b2686', '5b0bbcf818b46f09b70a4f507a66a4af'),
    ('internal.apply_ozow_refund_state(uuid,text,timestamp with time zone,timestamp with time zone,text)',
      '431e2541a83cf8e892efd61aa5cacd4d', '0ea76f550ca87fa76fe8431f390ceb4c'),
    ('internal.claim_ozow_refund_send(uuid)',
      'c16477b6080ff5e7075f63936cd5383b', '3b5affd02d571f3aa264dfd17ad938cb'),
    ('internal.za_public_holiday(date)', 'absent', 'da84c3f6ecadd2c77d9460af069ec241'),
    ('internal.za_business_day(date)', 'absent', '75386489557e85499d60cba6160b094a'),
    ('internal.first_purchase_last_ask_day(timestamp with time zone)',
      'absent', 'ef96b90f35d916053e7fa5ca05acebd4'),
    ('internal.payment_is_first_purchase(uuid)', 'absent', '3f369250c24ea059f2c3b13102981076'),
    ('internal.assert_first_purchase_refund(uuid,date)', 'absent', '2d9dff6d73922a859999ad1f349bd614'),
    ('internal.refund_left_cents(uuid,uuid)', 'absent', 'fceaee2d494b94bd4d1f38e1e4a0692e'),
    ('internal.staff_refund_result(private.payment_refund_requests,boolean)',
      'absent', 'cfe27e3019d6875bdd690f86a5f8fdbb'),
    ('internal.apply_staff_refund(uuid,uuid)', 'absent', 'cb274221e355aaa375113f2a6fe204e1'),
    ('internal.record_staff_refund(uuid,uuid,text,bigint,text,text,text,jsonb,text)',
      'absent', 'd076961cccdb12863765b3336cf7a6db'),
    ('internal.get_staff_refunds_left(uuid[])', 'absent', '5df1c510531ea6e328ca33cba01e0b9f'),
    ('api.record_staff_refund(uuid,uuid,text,bigint,text,text,text,jsonb,text)',
      'absent', 'bf894de8138626297c957328cb812fd6'),
    ('api.get_staff_refunds_left(uuid[])', 'absent', 'd721ae75b29975a22c613227abf39aa4')
  ) v(sig, reviewed, updated)
),
state as (
  select bool_and(b.body = b.reviewed) as absent, bool_and(b.body = b.updated) as applied from bodies b
),
problems as (
  select 'problem' as kind,
    sig || ' is neither the reviewed body nor the update''s (md5 ' || body || '); do not apply the update' as detail
  from bodies where body <> reviewed and body <> updated
)
select 'summary' as kind,
  'staff part refunds: '
    || case when s.applied then 'already applied'
         when s.absent then 'update not applied'
         else 'unexpected state' end
    || '; waiting for approval: '
    || (select count(*) from private.payment_refund_requests r where r.status = 'awaiting_approval')
    || '; through Ozow not sent: '
    || (select count(*) from private.payment_refund_requests r where r.channel = 'api' and r.status = 'approved')
    || '; part refunds: '
    || (select count(*) from private.payment_refund_requests r
        where r.amount_cents <> coalesce((select l.amount_cents from private.payment_lines l where l.id = r.payment_line_id),
          case when r.payment_line_id is null then (select p.amount_cents from private.payments p where p.id = r.payment_id) end)) as detail
from state s
union all
select kind, detail from problems;
