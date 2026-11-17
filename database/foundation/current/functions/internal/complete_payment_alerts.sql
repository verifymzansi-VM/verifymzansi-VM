-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.complete_payment_alerts(p_claim uuid, p_sent boolean)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare changed integer;
begin
  if p_claim is null or p_sent is null then
    raise exception 'invalid payment alert claim' using errcode='22023'; end if;
  if p_sent then
    update private.payment_problems set alerted_at=clock_timestamp(), alert_claimed_until=null
      where alert_claim=p_claim and alerted_at is null;
  else
    -- Given back: offered again, unchanged, on the next run.
    update private.payment_problems set alert_claimed_until=clock_timestamp()
      where alert_claim=p_claim and alerted_at is null;
  end if;
  get diagnostics changed=row_count;
  return changed;
end;
$function$;
alter function internal.complete_payment_alerts(uuid,boolean) owner to postgres;
revoke all on function internal.complete_payment_alerts(uuid,boolean) from public;
grant execute on function internal.complete_payment_alerts(uuid,boolean) to service_role;
