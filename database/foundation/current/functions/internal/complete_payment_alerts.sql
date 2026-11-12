-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.complete_payment_alerts(p_claim uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare sent integer;
begin
  if p_claim is null then raise exception 'invalid payment alert claim' using errcode='22023'; end if;
  update private.payment_problems set alerted_at=clock_timestamp(), alert_claimed_until=null
    where alert_claim=p_claim and alerted_at is null;
  get diagnostics sent=row_count;
  return sent;
end;
$function$;
alter function internal.complete_payment_alerts(uuid) owner to postgres;
revoke all on function internal.complete_payment_alerts(uuid) from public;
grant execute on function internal.complete_payment_alerts(uuid) to service_role;
