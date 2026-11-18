-- Read-only preflight for updates/20261118182332_refund_follow_ups.sql.
--
-- Run this file unchanged in the Supabase SQL editor before applying the
-- update, and again after it. It changes nothing: the first statement makes
-- the transaction read only, so Postgres refuses any write. The result has one
-- "summary" row, then one row per problem. Apply the update only when the
-- summary is the only row and reads "update not applied".
--
-- The summary says whether the ten functions the update replaces have the
-- reviewed earlier bodies and the six it adds are absent (update not
-- applied), the update's bodies (already applied), or a mix (unexpected
-- state), and counts, for staff to look at (none of them stops the update):
-- - "waiting for approval": refund records waiting for a second staff member;
-- - "through Ozow not sent": approved refunds through Ozow the server has not
--   sent yet;
-- - "past Ozow's 13 days": of those two, refunds through Ozow whose payment is
--   13 days old or older (after the update, approving one is refused and
--   sending one fails before anything is sent: pay it back by bank transfer);
-- - "while a renewal waits": waiting or approved refunds that would end a
--   period whose slot has a renewal bought and not started (after the update,
--   approving or sending one is refused: refund the renewal first);
-- - "declined references": declined records (their references may be
--   recorded again after the update).
do $$begin
  set transaction read only;
end$$;
with bodies as (
  select v.sig, v.reviewed, v.updated,
    coalesce((select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p where p.oid = to_regprocedure(v.sig)), 'absent') as body
  from (values
    ('internal.assert_staff_refund_reason(text,text,text)',
      '9bdc2d6c07af6313c21463bd5fdca8d0', 'f1f95b8057b5dc46696e5da2b4644685'),
    ('internal.assert_staff_refund_input(text,text,text,text)',
      '09b161b7933849f4f5c221dd3c6e6f6d', '8e66526256db946ba25b9f8462ecc9c1'),
    ('internal.staff_refund_repeat(uuid,uuid,uuid,text,text,text,text)',
      '31f93ac046f3cb4b73bc6896e8e4d2a3', '4abd76e6a63c1097cc9b3ae042b4d9fd'),
    ('internal.payment_refund_reference_rule()',
      '5f84fd9a07a75476cf72b741b20f5806', 'bcd393024fa7d491426eabe75841fda2'),
    ('internal.payment_refund_request_guard()',
      '08e1cff16910b59c8d305a1eae7f7b56', '11b86b7a627aad245c84433118601705'),
    ('internal.record_staff_payment_refund(uuid,text,text,text,text)',
      '2ba50b5b15c6259c1b2c6369d3473e90', '2c834ca09f144562cefe482972614952'),
    ('internal.record_staff_slot_refund(uuid,text,text,text,text)',
      '193a2b3abdbc83b0b16d81d759dc168e', '2113693e91e3fd2ecab28d36dc9f8df5'),
    ('internal.record_staff_ozow_refund(text,uuid,uuid,text,text,uuid,jsonb)',
      'b47de2156d93ce9ee6a48bcb6d206adc', 'f5bc560c0a12f637532ebf6492843ee6'),
    ('internal.approve_staff_payment_refund(uuid)',
      '6c7090e7cb1fee5fffd3c3495e76e2ab', '3bc44d6401afec9505b821cdd12f6ce5'),
    ('internal.claim_ozow_refund_send(uuid)',
      '0b9666cbe9d56092d32b11e326c1fb90', 'b16795912c3e917a1fa96b06239504b8'),
    ('internal.ozow_refund_window()',
      'absent', '87040940d4cf4f969d15867cc1100ca6'),
    ('internal.ozow_refund_window_open(uuid)',
      'absent', '23634fcb911129480d1c737d1f585d58'),
    ('internal.refund_by_bank_transfer(uuid,text)',
      'absent', '7a196d4327b5854a6a73a83280e515b0'),
    ('internal.refund_renewal_waiting(uuid,uuid)',
      'absent', '059a78b1022f10ff9bb7a9679001875b'),
    ('internal.refund_renewal_not_started(uuid,uuid)',
      'absent', '4d5c9cc568bfb4edd04da482d1a465dc'),
    ('internal.staff_refund_reference(uuid,text,text)',
      'absent', '4959d13e9ecc22a0ef6ed4bd94d99e7a')
  ) v(sig, reviewed, updated)
),
state as (
  select bool_and(b.body = b.reviewed) as absent, bool_and(b.body = b.updated) as applied from bodies b
),
open_refunds as (
  select r.* from private.payment_refund_requests r
  where r.status = 'awaiting_approval' or (r.channel = 'api' and r.status = 'approved')
),
problems as (
  select 'problem' as kind,
    sig || ' is neither the reviewed body nor the update''s (md5 ' || body || '); do not apply the update' as detail
  from bodies where body <> reviewed and body <> updated
)
select 'summary' as kind,
  'refund follow-ups: '
    || case when s.applied then 'already applied'
         when s.absent then 'update not applied'
         else 'unexpected state' end
    || '; waiting for approval: '
    || (select count(*) from open_refunds o where o.status = 'awaiting_approval')
    || '; through Ozow not sent: '
    || (select count(*) from open_refunds o where o.status = 'approved')
    || '; past Ozow''s 13 days: '
    || (select count(*) from open_refunds o join private.payments p on p.id = o.payment_id
        where o.channel = 'api' and p.created_at <= statement_timestamp() - interval '13 days')
    || '; while a renewal waits: '
    || (select count(*) from open_refunds o where o.kind = 'refunded' and exists(
        select 1 from private.entitlements e join private.entitlements n on n.renews_entitlement_id = e.id
        where e.payment_id = o.payment_id and (o.payment_line_id is null or e.payment_line_id = o.payment_line_id)
          and n.status <> 'revoked' and n.starts_at > statement_timestamp()))
    || '; declined references: '
    || (select count(*) from private.payment_refund_requests r where r.status = 'declined') as detail
from state s
union all
select kind, detail from problems;
