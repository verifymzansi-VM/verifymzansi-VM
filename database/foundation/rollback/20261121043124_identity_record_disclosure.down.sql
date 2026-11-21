-- Reviewed rollback for updates/20261121043124_identity_record_disclosure.sql.
-- Not part of the replay. Run it only if that update must be undone, after the
-- owner has decided so; prefer a forward fix. A website release with the
-- Authority requests pages needs the update: deploy a release without them
-- first (the pages otherwise answer "could not be loaded"), then run this.
-- The rollback puts back the staff audit trail view as it was, removes the
-- capability identity:disclose, and drops the five commands, their helpers and
-- the two disclosure logs. It refuses while the disclosure log holds any row:
-- authority request records are kept, so a rollback after the first opening
-- needs a forward fix instead.
begin;
set local lock_timeout='5s';

do $$begin
  if to_regclass('private.identity_disclosures') is null
    or to_regprocedure('api.open_identity_disclosure(text,text,text,text,text,text,text,boolean)') is null then
    raise exception 'rollback precondition: the identity record disclosure update is not applied' using errcode='55000';
  end if;
  if exists(select 1 from private.identity_disclosures) then
    raise exception 'rollback precondition: the disclosure log is not empty; keep it and fix forward' using errcode='55000';
  end if;
end$$;

-- The staff audit trail as it was before the update.
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
    ('payment:'::text || q.kind) || '_recorded'::text AS action,
    (((q.reason_code || ' (Ozow '::text) || q.ozow_reference) || '): '::text) || q.reason AS reason
   FROM private.payment_refund_requests q
UNION ALL
 SELECT 'payment_refund_approved:'::text || q.id::text AS id,
    q.applied_at AS occurred_at,
    q.approved_by AS actor_id,
    q.payment_id AS target_id,
    'payment'::text AS target_type,
    ('payment:'::text || q.kind) || '_approved'::text AS action,
    (((q.reason_code || ' (Ozow '::text) || q.ozow_reference) || '): '::text) || q.reason AS reason
   FROM private.payment_refund_requests q
  WHERE q.approved_by IS NOT NULL
UNION ALL
 SELECT 'payment_refund_declined:'::text || q.id::text AS id,
    q.declined_at AS occurred_at,
    q.declined_by AS actor_id,
    q.payment_id AS target_id,
    'payment'::text AS target_type,
    ('payment:'::text || q.kind) || '_declined'::text AS action,
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
  WHERE l.reversed_by IS NOT NULL
UNION ALL
 SELECT 'payment_invoice_recorded:'::text || t.id::text AS id,
    t.recorded_at AS occurred_at,
    t.recorded_by AS actor_id,
    COALESCE(t.payment_id, t.id) AS target_id,
    'payment'::text AS target_type,
    'payment:invoice_recorded'::text AS action,
    (((((((('Bank transfer '::text || t.bank_reference) || ' cleared '::text) || to_char(t.cleared_on::timestamp without time zone, 'YYYY-MM-DD'::text)) || ' ('::text) || t.slots) || ' slots, '::text) || t.amount_received_cents) || ' cents): '::text) || t.reason AS reason
   FROM private.invoice_transfers t
UNION ALL
 SELECT 'payment_invoice_confirmed:'::text || t.id::text AS id,
    t.confirmed_at AS occurred_at,
    t.confirmed_by AS actor_id,
    t.payment_id AS target_id,
    'payment'::text AS target_type,
    'payment:invoice_confirmed'::text AS action,
    ('Bank transfer '::text || t.bank_reference) || ' confirmed'::text AS reason
   FROM private.invoice_transfers t
  WHERE t.confirmed_by IS NOT NULL
UNION ALL
 SELECT 'payment_invoice_declined:'::text || t.id::text AS id,
    t.declined_at AS occurred_at,
    t.declined_by AS actor_id,
    t.id AS target_id,
    'payment'::text AS target_type,
    'payment:invoice_declined'::text AS action,
    (('Bank transfer '::text || t.bank_reference) || ' declined: '::text) || t.decline_reason AS reason
   FROM private.invoice_transfers t
  WHERE t.declined_by IS NOT NULL
UNION ALL
 SELECT 'payment_invoice_expired:'::text || t.id::text AS id,
    COALESCE(t.expired_at, t.recorded_at + internal.invoice_transfer_expires_after()) AS occurred_at,
    NULL::uuid AS actor_id,
    t.id AS target_id,
    'payment'::text AS target_type,
    'payment:invoice_expired'::text AS action,
    ('Bank transfer '::text || t.bank_reference) || ' expired: not confirmed within 14 days of being recorded'::text AS reason
   FROM private.invoice_transfers t
  WHERE internal.invoice_transfer_expired(t.*)
UNION ALL
 SELECT 'payment_invoice_resolved:'::text || t.id::text AS id,
    t.resolved_at AS occurred_at,
    t.resolved_by AS actor_id,
    t.id AS target_id,
    'payment'::text AS target_type,
    'payment:invoice_expired_resolved'::text AS action,
    (((('Bank transfer '::text || t.bank_reference) || ' expired, resolved: '::text) ||
        CASE t.resolution
            WHEN 'returned'::text THEN 'money returned outside VerifyMzansi'::text
            ELSE 'money never arrived'::text
        END) || ': '::text) || t.resolution_reason AS reason
   FROM private.invoice_transfers t
  WHERE t.resolved_by IS NOT NULL
UNION ALL
 SELECT 'customer_invoice_issued:'::text || i.id::text AS id,
    i.issued_at AS occurred_at,
    i.issued_by AS actor_id,
    i.id AS target_id,
    'payment'::text AS target_type,
    'payment:customer_invoice_issued'::text AS action,
    (((((('Invoice '::text || i.invoice_number) || ' ('::text) || i.slots) || ' slots, '::text) || i.total_cents) || ' cents): '::text) || i.issue_reason AS reason
   FROM private.customer_invoices i
UNION ALL
 SELECT 'customer_invoice_voided:'::text || i.id::text AS id,
    i.voided_at AS occurred_at,
    i.voided_by AS actor_id,
    i.id AS target_id,
    'payment'::text AS target_type,
    'payment:customer_invoice_voided'::text AS action,
    (('Invoice '::text || i.invoice_number) || ' voided: '::text) || i.void_reason AS reason
   FROM private.customer_invoices i
  WHERE i.voided_by IS NOT NULL;
alter view private.frontend_staff_audit_events owner to postgres;
revoke all on private.frontend_staff_audit_events from public;

drop function if exists api.open_identity_disclosure(text,text,text,text,text,text,text,boolean);
drop function if exists internal.open_identity_disclosure(text,text,text,text,text,text,text,boolean);
drop function if exists api.read_identity_disclosure(uuid,text,uuid);
drop function if exists internal.read_identity_disclosure(uuid,text,uuid);
drop function if exists api.close_identity_disclosure(uuid);
drop function if exists internal.close_identity_disclosure(uuid);
drop function if exists api.list_identity_disclosures();
drop function if exists internal.list_identity_disclosures();
drop function if exists api.identity_disclosure_material(uuid,uuid);
drop function if exists internal.identity_disclosure_material(uuid,uuid);
drop function if exists internal.identity_disclosure_record(private.identity_disclosures,uuid);
drop function if exists internal.identity_disclosure_open_for(uuid,uuid,uuid);
drop function if exists internal.identity_disclosure_text_ok(text,integer,integer);
drop table if exists private.identity_disclosure_events;
drop table if exists private.identity_disclosures;
delete from private.staff_capabilities where capability='identity:disclose';

notify pgrst,'reload schema';
commit;
