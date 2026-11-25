-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.complete_lost_email_alert(p_claim uuid, p_sent boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if p_claim is null or p_sent is null then
    raise exception 'invalid lost email alert claim' using errcode='22023'; end if;
  -- Sent: never offered again. Given back: offered again, unchanged, on the
  -- next run.
  update private.lost_email_alerts
    set sent_at=case when p_sent then clock_timestamp() end,
      claimed_until=case when p_sent then claimed_until else clock_timestamp() end
    where id=p_claim and sent_at is null;
  return found;
end;
$function$;
alter function internal.complete_lost_email_alert(uuid,boolean) owner to postgres;
revoke all on function internal.complete_lost_email_alert(uuid,boolean) from public;
grant execute on function internal.complete_lost_email_alert(uuid,boolean) to service_role;
