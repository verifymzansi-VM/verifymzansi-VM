-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.get_my_payment(p_payment_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.price_draft_actor(); result jsonb;
begin
  select internal.billing_payment_dto(p) into result from private.payments p
    where p.id=p_payment_id and p.owner_id=actor;
  perform internal.price_draft_actor();
  return result;
end;
$function$;
alter function internal.get_my_payment(uuid) owner to postgres;
revoke all on function internal.get_my_payment(uuid) from public;
grant execute on function internal.get_my_payment(uuid) to authenticated;
