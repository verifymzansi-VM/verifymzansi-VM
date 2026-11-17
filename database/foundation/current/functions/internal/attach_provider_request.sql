-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.attach_provider_request(p_payment_id uuid, p_request_id text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
begin
  update private.payments p set provider_request_id = p_request_id
  where p.id = p_payment_id and p.status = 'pending'
    and (p.provider_request_id is null or p.provider_request_id = p_request_id);
  if not found then raise exception 'payment not pending or request id differs' using errcode = '22023'; end if;
  return true;
end;
$function$;
alter function internal.attach_provider_request(uuid,text) owner to postgres;
revoke all on function internal.attach_provider_request(uuid,text) from public;
grant execute on function internal.attach_provider_request(uuid,text) to service_role;
