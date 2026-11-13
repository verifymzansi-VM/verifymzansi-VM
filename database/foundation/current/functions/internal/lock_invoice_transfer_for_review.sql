-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.lock_invoice_transfer_for_review(p_transfer_id uuid, p_actor uuid)
 RETURNS private.invoice_transfers
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare t private.invoice_transfers;
begin
  if p_transfer_id is null then raise exception 'recorded bank transfer required' using errcode='22023'; end if;
  select * into t from private.invoice_transfers x where x.id = p_transfer_id;
  if not found then raise exception 'recorded bank transfer not found' using errcode='22023'; end if;
  perform internal.assert_staff_payment_actor(p_actor, t.account_id);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('invoice-bank-reference:'
    ||upper(regexp_replace(t.bank_reference, '[^A-Za-z0-9]', '', 'g')), 707));
  perform internal.lock_evidence_subject(t.account_id);
  select * into t from private.invoice_transfers x where x.id = p_transfer_id for update;
  if internal.staff_actor('payments:confirm_transfer') is distinct from p_actor then
    raise exception 'staff actor changed' using errcode='42501';
  end if;
  perform internal.assert_staff_payment_actor(p_actor, t.account_id);
  perform internal.assert_staff_not_referrer(p_actor, t.account_id);
  return t;
end;
$function$;
alter function internal.lock_invoice_transfer_for_review(uuid,uuid) owner to postgres;
revoke all on function internal.lock_invoice_transfer_for_review(uuid,uuid) from public;
