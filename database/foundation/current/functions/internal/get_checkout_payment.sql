-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.get_checkout_payment(p_payment_id uuid, p_merchant_reference text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare result jsonb;
begin
  if (p_payment_id is null)=(p_merchant_reference is null) then
    raise exception 'one payment selector required' using errcode='22023'; end if;
  select internal.billing_payment_dto(p) into result from private.payments p
    where p.id=p_payment_id or p.merchant_reference=p_merchant_reference;
  return result;
end;
$function$;
alter function internal.get_checkout_payment(uuid,text) owner to postgres;
revoke all on function internal.get_checkout_payment(uuid,text) from public;
grant execute on function internal.get_checkout_payment(uuid,text) to service_role;
