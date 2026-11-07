-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.complete_frontend_privacy_notice(p_job uuid, p_claim uuid, p_delivered boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare j private.privacy_notice_jobs;now_at timestamptz:=clock_timestamp();
begin
  if p_delivered is null then raise exception 'delivery outcome required' using errcode='22023';end if;
  select * into j from private.privacy_notice_jobs where id=p_job for update;
  if not found or j.claim_token is distinct from p_claim or j.delivered_at is not null or j.locked_until<=now_at
    or j.claim_token is null then return false;end if;
  update private.privacy_notice_jobs set claim_token=null,locked_until=null,
    delivered_at=case when p_delivered then now_at end,
    next_attempt_at=now_at+make_interval(mins=>least(360,1<<j.attempts)) where id=j.id;
  if p_delivered and j.kind='extended' then
    update private.privacy_requests set extension_notified_at=now_at where id=j.request_id and extension_notified_at is null;
  end if;
  return true;
end$function$;
alter function internal.complete_frontend_privacy_notice(uuid,uuid,boolean) owner to postgres;
revoke all on function internal.complete_frontend_privacy_notice(uuid,uuid,boolean) from public;
grant execute on function internal.complete_frontend_privacy_notice(uuid,uuid,boolean) to service_role;
