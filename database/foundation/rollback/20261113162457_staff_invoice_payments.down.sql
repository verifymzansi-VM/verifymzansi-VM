-- Reviewed rollback for updates/20261113162457_staff_invoice_payments.sql.
-- Not part of the replay. Run it only if that update must be undone, after the
-- owner has decided so; prefer a forward fix. Revert and deploy the website
-- release that uses the update FIRST: this rollback removes the commands that
-- release calls (recording, confirming and declining a bank transfer and
-- reading its details).
--
-- It works only while no bank transfer was recorded: it refuses (55000) once
-- private.payments holds a payment with provider 'invoice' or
-- private.invoice_transfers has a row (waiting, confirmed or declined),
-- because those are payment and audit records. After that, fix forward.
--
-- It puts back the receipt read and the staff audit view of
-- 20261113021223_staff_payment_fixes.sql, drops the update's functions, its
-- table and trigger and the capability payments:confirm_transfer, and puts
-- back the earlier payment rules (payments_provider_check: Ozow only;
-- payments_check1: a complete payment has an Ozow transaction id;
-- payments_invoice_without_ozow removed). Ozow payments, slots, entitlements
-- and commissions are untouched.
begin;
set local lock_timeout='5s';

lock table private.payments in share row exclusive mode;
do $$begin
  if to_regclass('private.invoice_transfers') is not null then
    lock table private.invoice_transfers in exclusive mode;
  end if;
end$$;

do $$
declare transfers bigint; records bigint;
begin
    if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.invoice_transfer_guard()')) is distinct from '2797782f05696a8cbabcd243efb716e6'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.assert_staff_not_referrer(uuid,uuid)')) is distinct from '1e9fa59ac5ab01018789e91e882e4363'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.invoice_customer_by_email(text)')) is distinct from 'd972c0ebbd47f3bd5fbe7cd355ddf446'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.invoice_transfer_dto(private.invoice_transfers,uuid)')) is distinct from '271116a2ef1b920f162c0c6e3dd9d367'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.get_staff_invoice_customer(text)')) is distinct from '6a57d5ad1c9ab0ff8cd97c991afd38b7'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('api.get_staff_invoice_customer(text)')) is distinct from '5d0cac600807f6a77ef8a41ec0180246'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.record_staff_invoice_payment(text,integer,integer,bigint,text,text,boolean,text)')) is distinct from '6b00db574fbf4056485339f1766460b9'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('api.record_staff_invoice_payment(text,integer,integer,bigint,text,text,boolean,text)')) is distinct from '2428c38dc7877ae2ca3fb3c4c9ea5b1b'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.lock_invoice_transfer_for_review(uuid,uuid)')) is distinct from 'bf73096cddd3d08eb23f6b0dd87967ee'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.confirm_staff_invoice_payment(uuid)')) is distinct from '216b293e1b4104ee91657556956b2204'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('api.confirm_staff_invoice_payment(uuid)')) is distinct from 'cf439d1781015f8561f5bf7c1f326186'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.decline_staff_invoice_payment(uuid,text)')) is distinct from 'cc8641faee31c5a9a043e4c510d26302'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('api.decline_staff_invoice_payment(uuid,text)')) is distinct from '5074950cec394946e97e5ec183d77d9c'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.get_staff_invoice_transfers()')) is distinct from '37ec35ae8968df035025e3c69234f3be'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('api.get_staff_invoice_transfers()')) is distinct from 'cfc5c52c20818b63133e796f75600c0f'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.get_staff_invoice_payments(uuid[])')) is distinct from '96c9643c1e0128672d6528f0e4f61aaf'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('api.get_staff_invoice_payments(uuid[])')) is distinct from '526991f8c1f78cacddb8558606f31c2c'
    or (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc where oid=to_regprocedure('internal.get_payment_receipt(uuid)')) is distinct from '82b6d1f1a4f8f1b7e1325c71146b453d'
    or to_regclass('private.invoice_transfers') is null then
    raise exception 'rollback precondition: the staff invoice payments update is not applied' using errcode='55000';
  end if;
  select count(*) into transfers from private.payments where provider = 'invoice';
  select count(*) into records from private.invoice_transfers;
  if transfers > 0 or records > 0 then
    raise exception 'rollback precondition: staff already recorded bank transfers (% invoice payments, % records); fix forward with a new update',
      transfers, records using errcode='55000';
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
   FROM private.frontend_payment_reversals r
UNION ALL
 SELECT 'payment_activation:'::text || a.payment_id::text AS id,
    a.created_at AS occurred_at,
    a.actor_id,
    a.payment_id AS target_id,
    'payment'::text AS target_type,
    'payment:activated'::text AS action,
    a.reason
   FROM private.payment_activations a
UNION ALL
 SELECT 'payment_refund_request:'::text || q.id::text AS id,
    q.requested_at AS occurred_at,
    q.requested_by AS actor_id,
    q.payment_id AS target_id,
    'payment'::text AS target_type,
    'payment:'::text || q.kind || '_recorded'::text AS action,
    q.reason_code || ' (Ozow '::text || q.ozow_reference || '): '::text || q.reason AS reason
   FROM private.payment_refund_requests q
UNION ALL
 SELECT 'payment_refund_approved:'::text || q.id::text AS id,
    q.applied_at AS occurred_at,
    q.approved_by AS actor_id,
    q.payment_id AS target_id,
    'payment'::text AS target_type,
    'payment:'::text || q.kind || '_approved'::text AS action,
    q.reason_code || ' (Ozow '::text || q.ozow_reference || '): '::text || q.reason AS reason
   FROM private.payment_refund_requests q
  WHERE q.approved_by IS NOT NULL
UNION ALL
 SELECT 'payment_refund_declined:'::text || q.id::text AS id,
    q.declined_at AS occurred_at,
    q.declined_by AS actor_id,
    q.payment_id AS target_id,
    'payment'::text AS target_type,
    'payment:'::text || q.kind || '_declined'::text AS action,
    q.decline_reason AS reason
   FROM private.payment_refund_requests q
  WHERE q.declined_by IS NOT NULL
UNION ALL
 SELECT 'payment_slot:'::text || l.id::text AS id,
    l.reversed_at AS occurred_at,
    l.reversed_by AS actor_id,
    l.payment_id AS target_id,
    'payment'::text AS target_type,
    'payment:slot_'::text || l.reversal_kind AS action,
    l.reversal_reason AS reason
   FROM private.payment_lines l
  WHERE l.reversed_by IS NOT NULL;
alter view private.frontend_staff_audit_events owner to postgres;
revoke all on private.frontend_staff_audit_events from public, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION internal.get_payment_receipt(p_payment_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
  select jsonb_build_object('payment_id', p.id, 'owner_id', p.owner_id, 'amount_cents', p.amount_cents,
    'currency', p.currency, 'completed_at', p.completed_at, 'product_kind', p.product_kind,
    'label', coalesce(p.snapshot->>'label', initcap(p.snapshot->>'addon')||' add-on', 'Payment'),
    'slots', case when p.product_kind = 'plan' and jsonb_typeof(p.snapshot->'slots') = 'number'
      then p.snapshot->'slots' else 'null'::jsonb end,
    'invoice_description', i.description, 'invoice_number', i.invoice_number, 'issued_at', i.issued_at,
    'merchant_reference', p.merchant_reference, 'provider_transaction_id', p.provider_transaction_id,
    'status', p.status, 'fulfillment_status', p.fulfillment_status)
  from private.payments p left join private.invoices i on i.payment_id = p.id
  where p.id = p_payment_id;
$function$;
alter function internal.get_payment_receipt(uuid) owner to postgres;
revoke all on function internal.get_payment_receipt(uuid) from public, anon, authenticated, service_role;
grant execute on function internal.get_payment_receipt(uuid) to service_role;

drop function api.record_staff_invoice_payment(text,integer,integer,bigint,text,text,boolean,text);
drop function api.confirm_staff_invoice_payment(uuid);
drop function api.decline_staff_invoice_payment(uuid,text);
drop function api.get_staff_invoice_transfers();
drop function api.get_staff_invoice_payments(uuid[]);
drop function api.get_staff_invoice_customer(text);
drop function internal.record_staff_invoice_payment(text,integer,integer,bigint,text,text,boolean,text);
drop function internal.confirm_staff_invoice_payment(uuid);
drop function internal.decline_staff_invoice_payment(uuid,text);
drop function internal.lock_invoice_transfer_for_review(uuid,uuid);
drop function internal.get_staff_invoice_transfers();
drop function internal.get_staff_invoice_payments(uuid[]);
drop function internal.get_staff_invoice_customer(text);
drop function internal.invoice_transfer_dto(private.invoice_transfers,uuid);
drop function internal.invoice_customer_by_email(text);
drop function internal.assert_staff_not_referrer(uuid,uuid);
drop trigger invoice_transfers_guard on private.invoice_transfers;
drop function internal.invoice_transfer_guard();
drop table private.invoice_transfers;
delete from private.staff_capabilities where role = 'admin' and capability = 'payments:confirm_transfer';

alter table private.payments drop constraint payments_invoice_without_ozow;
alter table private.payments drop constraint payments_check1;
alter table private.payments add constraint payments_check1 check ((status = 'complete')
  = (completed_at is not null and provider_transaction_id is not null) or status in ('refunded', 'chargeback'));
alter table private.payments drop constraint payments_provider_check;
alter table private.payments add constraint payments_provider_check check (provider = 'ozow');

commit;
