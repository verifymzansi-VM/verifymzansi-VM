-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.finish_unpaid_checkout(p_payment_id uuid, p_status text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if p_status not in ('cancelled','expired') then raise exception 'invalid unpaid status' using errcode='22023'; end if;
  update private.payments set status=p_status,status_changed_at=clock_timestamp() where id=p_payment_id and status='pending';
  return found;
end;
$function$;
alter function internal.finish_unpaid_checkout(uuid,text) owner to postgres;
revoke all on function internal.finish_unpaid_checkout(uuid,text) from public;
grant execute on function internal.finish_unpaid_checkout(uuid,text) to service_role;
