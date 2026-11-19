-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.lock_package_invoice_request(p_request_id uuid, p_actor uuid, p_capability text)
 RETURNS private.package_invoice_requests
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare r private.package_invoice_requests;
begin
  if p_request_id is null then
    raise exception 'invoice request not found' using errcode='PT404', detail='package_invoice_request_unavailable';
  end if;
  select * into r from private.package_invoice_requests x where x.id = p_request_id;
  if not found then
    raise exception 'invoice request not found' using errcode='PT404', detail='package_invoice_request_unavailable';
  end if;
  perform internal.assert_staff_payment_actor(p_actor, r.account_id);
  perform internal.lock_evidence_subject(r.account_id);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(r.account_id::text, 707));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('slot-package:'||r.account_id::text, 707));
  select * into r from private.package_invoice_requests x where x.id = p_request_id for update;
  if internal.staff_actor(p_capability) is distinct from p_actor then
    raise exception 'staff actor changed' using errcode='42501';
  end if;
  perform internal.assert_staff_payment_actor(p_actor, r.account_id);
  perform internal.assert_staff_not_referrer(p_actor, r.account_id);
  return r;
end;
$function$;
alter function internal.lock_package_invoice_request(uuid,uuid,text) owner to postgres;
revoke all on function internal.lock_package_invoice_request(uuid,uuid,text) from public;
