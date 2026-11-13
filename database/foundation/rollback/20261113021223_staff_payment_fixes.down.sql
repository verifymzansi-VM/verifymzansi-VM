-- Reviewed rollback for updates/20261113021223_staff_payment_fixes.sql.
-- Not part of the replay. Run it only if that update must be undone, after the
-- owner has decided so; prefer a forward fix. Revert and deploy the website
-- release that uses the update FIRST: this rollback removes the commands that
-- release calls (the staff payments list, activation and refund commands).
--
-- It works only while no staff member has activated a payment or recorded a
-- refund or chargeback with the new commands: it refuses (55000) once
-- private.payment_activations or private.payment_refund_requests has a row,
-- because those are payment audit records. After that, fix forward.
--
-- It puts back the staff audit view of 20261105201822 (without activations,
-- refund requests and single-slot reversals), drops the update's 24 functions,
-- its triggers (also the two it adds to payments and payment lines) and its
-- two tables. Payments, slots, entitlements and
-- commissions are untouched.
begin;
set local lock_timeout='5s';

do $$begin
  if to_regclass('private.payment_activations') is not null then
    lock table private.payment_activations in exclusive mode;
  end if;
  if to_regclass('private.payment_refund_requests') is not null then
    lock table private.payment_refund_requests in exclusive mode;
  end if;
end$$;

do $$
declare activations bigint; requests bigint;
begin
    if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.payment_activation_guard()')) is distinct from '17f0db127d434686154ba2db29b4e244'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.payment_refund_request_guard()')) is distinct from 'ac76d0b81b37bbfc12ad483e7eadf9cf'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.payment_delivery_commission(uuid)')) is distinct from '173b97b47147f69d097daba72def56d9'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.get_staff_payment_list(integer,text)')) is distinct from '7511534bec5595b3641450e9a88ccfdb'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('api.get_staff_payment_list(integer,text)')) is distinct from 'a96efb8aa9552502327936ecf4e05d5f'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.assert_staff_payment_actor(uuid,uuid)')) is distinct from 'fe81cc39557206e06346fcf5e9f33bfd'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.activate_staff_paid_payment(uuid,text)')) is distinct from 'd388959dfaee486c2d82b3d5e6f5e709'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('api.activate_staff_paid_payment(uuid,text)')) is distinct from '38ff2863e1c58cd9cb7d6dd22636ad10'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.assert_staff_refund_input(text,text,text,text)')) is distinct from '09b161b7933849f4f5c221dd3c6e6f6d'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.staff_refund_repeat(uuid,uuid,uuid,text,text,text,text)')) is distinct from '6e38d5e6f28b5ed84b79388329effc18'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.chargebacks_need_approval()')) is distinct from 'fea61f3c66945592f0c658d93dd2c747'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.payment_refunded_before_cents(uuid)')) is distinct from 'deeeb438b3d54710a061b49a4e52e9f5'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.refund_needs_approval(text,bigint,bigint)')) is distinct from '7f3795506bf5dedfc96e78c6adb0b1ff'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.record_staff_payment_refund(uuid,text,text,text,text)')) is distinct from '03691c9ff0eb92fed4be87b11c1fb15b'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('api.record_staff_payment_refund(uuid,text,text,text,text)')) is distinct from 'c88c371f4398b69da822669fe832dac9'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.record_staff_slot_refund(uuid,text,text,text,text)')) is distinct from 'a315072d628da2b6f164491cbc1a0076'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('api.record_staff_slot_refund(uuid,text,text,text,text)')) is distinct from '74bae46217113296da99631b7a316e76'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.approve_staff_payment_refund(uuid)')) is distinct from 'f757a5e1ac7aa4a199dbcd05f5465083'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('api.approve_staff_payment_refund(uuid)')) is distinct from 'c940eeb3f76b9bdd82e4377909b97cc0'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.decline_staff_payment_refund(uuid,text)')) is distinct from '494408ef422ce9389cd096722ea8d63a'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('api.decline_staff_payment_refund(uuid,text)')) is distinct from 'e05112535fb4c6e13589f4f339a74dec'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.payment_reversal_waiting_guard()')) is distinct from 'ee9f44cbbc9d2b70cd6db25f90dc7acb'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.get_payment_receipt(uuid)')) is distinct from '1c8ef468ae622086d57af8b8c16fb886'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('api.get_payment_receipt(uuid)')) is distinct from '245869d4f4c606db44bc43c0cea8c4e3'
    or to_regclass('private.payment_activations') is null
    or to_regclass('private.payment_refund_requests') is null then
    raise exception 'rollback precondition: the staff payment fixes update is not applied' using errcode='55000';
  end if;
  select count(*) into activations from private.payment_activations;
  select count(*) into requests from private.payment_refund_requests;
  if activations > 0 or requests > 0 then
    raise exception 'rollback precondition: staff already used the new commands (% activations, % refund records); fix forward with a new update',
      activations, requests using errcode='55000';
  end if;
end$$;

create or replace view private.frontend_staff_audit_events with (security_invoker=true) as
 SELECT frontend_staff_nonpayment_audit_events.id,
    frontend_staff_nonpayment_audit_events.occurred_at,
    frontend_staff_nonpayment_audit_events.actor_id,
    frontend_staff_nonpayment_audit_events.target_id,
    frontend_staff_nonpayment_audit_events.target_type,
    frontend_staff_nonpayment_audit_events.action,
    frontend_staff_nonpayment_audit_events.reason
   FROM private.frontend_staff_nonpayment_audit_events
UNION ALL
 SELECT 'payment:'::text || r.payment_id::text AS id,
    r.created_at AS occurred_at,
    r.actor_id,
    r.payment_id AS target_id,
    'payment'::text AS target_type,
    'payment:'::text || r.kind AS action,
    r.reason
   FROM private.frontend_payment_reversals r;
alter view private.frontend_staff_audit_events owner to postgres;
revoke all on private.frontend_staff_audit_events from public;

drop function api.get_staff_payment_list(integer,text);
drop function api.activate_staff_paid_payment(uuid,text);
drop function api.record_staff_payment_refund(uuid,text,text,text,text);
drop function api.record_staff_slot_refund(uuid,text,text,text,text);
drop function api.approve_staff_payment_refund(uuid);
drop function api.decline_staff_payment_refund(uuid,text);
drop function api.get_payment_receipt(uuid);
drop function internal.payment_delivery_commission(uuid);
drop function internal.get_staff_payment_list(integer,text);
drop function internal.assert_staff_payment_actor(uuid,uuid);
drop function internal.activate_staff_paid_payment(uuid,text);
drop function internal.assert_staff_refund_input(text,text,text,text);
drop function internal.staff_refund_repeat(uuid,uuid,uuid,text,text,text,text);
drop function internal.chargebacks_need_approval();
drop function internal.payment_refunded_before_cents(uuid);
drop function internal.refund_needs_approval(text,bigint,bigint);
drop function internal.record_staff_payment_refund(uuid,text,text,text,text);
drop function internal.record_staff_slot_refund(uuid,text,text,text,text);
drop function internal.approve_staff_payment_refund(uuid);
drop function internal.decline_staff_payment_refund(uuid,text);
drop function internal.get_payment_receipt(uuid);
drop trigger payments_refund_waiting on private.payments;
drop trigger payment_lines_refund_waiting on private.payment_lines;
drop function internal.payment_reversal_waiting_guard();
drop trigger payment_activations_immutable on private.payment_activations;
drop trigger payment_refund_requests_guard on private.payment_refund_requests;
drop function internal.payment_activation_guard();
drop function internal.payment_refund_request_guard();
drop table private.payment_refund_requests;
drop table private.payment_activations;

commit;
