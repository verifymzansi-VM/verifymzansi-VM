-- Read-only preflight for updates/20261113021223_staff_payment_fixes.sql.
--
-- Run this file unchanged in the Supabase SQL editor before applying the
-- update, and again after it. It changes nothing: the first statement makes
-- the transaction read only, so Postgres refuses any write. The result has one
-- "summary" row, then one row per problem. Apply the update only when the
-- summary is the only row and reads "update not applied".
--
-- The summary says whether the update is absent (its 24 functions and two
-- tables are absent and the staff audit view does not list activations) or
-- applied (every body is the update's), and counts the payments that are paid
-- but not delivered (complete and needs_reconciliation) and, once applied,
-- the refunds waiting for a second staff member. A problem row is shown when
-- 20261113002421_individual_slots_r69.sql is not applied with its reviewed
-- bodies (this update needs them).
do $$begin
  set transaction read only;
end$$;
with added as (
  select v.sig, v.after,
    (select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p where p.oid = to_regprocedure(v.sig)) as body
  from (values
    ('internal.payment_activation_guard()', '17f0db127d434686154ba2db29b4e244'),
    ('internal.payment_refund_request_guard()', '6af0f7c33d649e537fce88a6831b5a2a'),
    ('internal.payment_delivery_commission(uuid)', '173b97b47147f69d097daba72def56d9'),
    ('internal.get_staff_payment_list(integer,text)', '7511534bec5595b3641450e9a88ccfdb'),
    ('api.get_staff_payment_list(integer,text)', 'a96efb8aa9552502327936ecf4e05d5f'),
    ('internal.assert_staff_payment_actor(uuid,uuid)', 'fe81cc39557206e06346fcf5e9f33bfd'),
    ('internal.activate_staff_paid_payment(uuid,text)', 'd388959dfaee486c2d82b3d5e6f5e709'),
    ('api.activate_staff_paid_payment(uuid,text)', '38ff2863e1c58cd9cb7d6dd22636ad10'),
    ('internal.assert_staff_refund_input(text,text,text,text)', '09b161b7933849f4f5c221dd3c6e6f6d'),
    ('internal.staff_refund_repeat(uuid,uuid,uuid,text,text,text,text)', '6e38d5e6f28b5ed84b79388329effc18'),
    ('internal.chargebacks_need_approval()', 'fea61f3c66945592f0c658d93dd2c747'),
    ('internal.payment_refunded_before_cents(uuid)', 'deeeb438b3d54710a061b49a4e52e9f5'),
    ('internal.refund_needs_approval(text,bigint,bigint)', '7f3795506bf5dedfc96e78c6adb0b1ff'),
    ('internal.record_staff_payment_refund(uuid,text,text,text,text)', '03691c9ff0eb92fed4be87b11c1fb15b'),
    ('api.record_staff_payment_refund(uuid,text,text,text,text)', 'c88c371f4398b69da822669fe832dac9'),
    ('internal.record_staff_slot_refund(uuid,text,text,text,text)', 'a315072d628da2b6f164491cbc1a0076'),
    ('api.record_staff_slot_refund(uuid,text,text,text,text)', '74bae46217113296da99631b7a316e76'),
    ('internal.approve_staff_payment_refund(uuid)', '3ab93e11833cd0faa37ac45122aaa413'),
    ('api.approve_staff_payment_refund(uuid)', 'c940eeb3f76b9bdd82e4377909b97cc0'),
    ('internal.decline_staff_payment_refund(uuid,text)', '494408ef422ce9389cd096722ea8d63a'),
    ('api.decline_staff_payment_refund(uuid,text)', 'e05112535fb4c6e13589f4f339a74dec'),
    ('internal.payment_reversal_waiting_guard()', 'ffa0a62683e2e1b9360be710a6a44493'),
    ('internal.get_payment_receipt(uuid)', '1c8ef468ae622086d57af8b8c16fb886'),
    ('api.get_payment_receipt(uuid)', '245869d4f4c606db44bc43c0cea8c4e3')
  ) v(sig, after)
),
needed as (
  select v.sig, v.reviewed,
    (select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p where p.oid = to_regprocedure(v.sig)) as body
  from (values
    ('internal.assert_staff_acts_for_other(uuid,uuid,text)', 'ed7d0d3df9bdade439b2df65126d5506'),
    ('internal.same_identity(uuid,uuid)', '535e5c87d944edd45bd2b3dce28f98b6'),
    ('internal.reverse_payment(uuid,text,text)', '66005adb9e06b17e689dbac47ce93d5a'),
    ('internal.record_staff_slot_reversal(uuid,text,text)', '1364f8c78e36281bae5f16a4ba5a466c'),
    ('internal.payment_partner_commission()', 'e99f071fae090328566a61186843c6e2'),
    ('internal.apply_provider_event(jsonb)', '8a226003da741381225c11dfd1e44308')
  ) v(sig, reviewed)
),
tables as (
  select v.name, to_regclass(v.name) is not null as present
  from (values ('private.payment_activations'), ('private.payment_refund_requests')) v(name)
),
audit_view as (
  select coalesce(pg_get_viewdef('private.frontend_staff_audit_events'::regclass) like '%payment_activations%', false)
    as lists_activations
),
state as (
  select
    (select count(*) from added where body is null) + (select count(*) from tables where not present)
      + (select count(*) from audit_view where not lists_activations) as absent,
    (select count(*) from added where body = after) + (select count(*) from tables where present)
      + (select count(*) from audit_view where lists_activations) as updated,
    (select count(*) from added) + (select count(*) from tables) + 1 as total
),
problems as (
  select 'problem' as kind, sig || ' is not the update''s body (md5 ' || body || '); do not apply the update' as detail
    from added where body is not null and body is distinct from after
  union all
  select 'problem', sig || ' is not the reviewed body of 20261113002421_individual_slots_r69.sql (md5 '
      || coalesce(body, 'missing') || '); apply that update first'
    from needed where body is distinct from reviewed
  union all
  select 'problem', 'only part of the update is present'
    from state where absent <> total and updated <> total
      and not exists (select 1 from added where body is not null and body is distinct from after)
)
select 'summary' as kind,
  'staff payment fixes: '
    || case when s.updated = s.total then 'already applied'
         when s.absent = s.total then 'update not applied (apply before the website release that uses it is deployed)'
         else 'unexpected state' end
    || '; paid but not delivered: '
    || (select count(*) from private.payments where status = 'complete' and fulfillment_status = 'needs_reconciliation')
    || '; refunds waiting for approval: '
    || case when to_regclass('private.payment_refund_requests') is null then 'none (table absent)'
         else (xpath('/row/n/text()', query_to_xml(
           'select count(*) as n from private.payment_refund_requests where status = ''awaiting_approval''',
           false, true, '')))[1]::text
       end as detail
from state s
union all
select kind, detail from problems;
