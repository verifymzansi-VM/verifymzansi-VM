-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.complete_notification_outbox(p_id uuid, p_claim uuid, p_ok boolean, p_error text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare changed integer;
begin
  if p_ok is null or (p_error is not null and p_error !~ '^[a-z_]{1,80}$') then
    raise exception 'invalid outcome' using errcode='22023'; end if;
  update private.outbox_events set processed_at=case when p_ok then statement_timestamp() else null end,
    delivery_claim=null,delivery_until=null,delivery_error=case when p_ok then null else coalesce(p_error,'delivery_failed') end,
    delivery_after=statement_timestamp()+make_interval(secs=>least(21600,30*(2^least(delivery_attempts,9))::integer))
  where id=p_id and delivery_claim=p_claim and processed_at is null and delivery_until>statement_timestamp();
  get diagnostics changed=row_count;
  return changed=1;
end;
$function$;
alter function internal.complete_notification_outbox(uuid,uuid,boolean,text) owner to postgres;
revoke all on function internal.complete_notification_outbox(uuid,uuid,boolean,text) from public;
grant execute on function internal.complete_notification_outbox(uuid,uuid,boolean,text) to service_role;
