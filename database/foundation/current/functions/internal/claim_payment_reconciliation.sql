-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.claim_payment_reconciliation(p_payment_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare pay private.payments;
begin
  update private.payments set reconciliation_checked_at=clock_timestamp()
  where id=p_payment_id and provider_request_id is not null and status in ('pending','failed','expired','cancelled')
    and (reconciliation_checked_at is null or reconciliation_checked_at<clock_timestamp()-interval '15 seconds')
  returning * into pay;
  if not found then return null; end if;
  return internal.billing_payment_dto(pay);
end;
$function$;
alter function internal.claim_payment_reconciliation(uuid) owner to postgres;
revoke all on function internal.claim_payment_reconciliation(uuid) from public;
grant execute on function internal.claim_payment_reconciliation(uuid) to service_role;
