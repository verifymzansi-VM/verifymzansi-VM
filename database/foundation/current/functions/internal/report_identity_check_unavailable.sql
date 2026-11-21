-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.report_identity_check_unavailable(p_check uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare k private.identity_checks; s private.identity_check_settings; now_at timestamptz:=clock_timestamp(); newly boolean;
begin
  if p_check is null or p_reason is null or p_reason not in('no_credit','outage','not_configured') then
    raise exception 'unavailable reason required' using errcode='22023'; end if;
  select x.* into k from private.identity_checks x where x.id=p_check for update;
  if not found or (k.status<>'unavailable' and (k.status<>'started' or k.session_id is not null)) then
    raise exception 'identity check without a session required' using errcode='PT409'; end if;
  if k.status='started' then
    update private.identity_checks set status='unavailable',finished_at=now_at where id=k.id; end if;
  select x.* into s from private.identity_check_settings x where x.id for update;
  newly:=s.paused_until is null or s.paused_until<=now_at;
  update private.identity_check_settings set
    paused_until=greatest(case when newly then now_at else paused_until end,
      now_at+case p_reason when 'outage' then interval '15 minutes' else interval '1 hour' end),
    pause_reason=p_reason where id returning * into s;
  return jsonb_build_object('paused_until',s.paused_until,'pause_reason',s.pause_reason,'newly_paused',newly);
end$function$;
alter function internal.report_identity_check_unavailable(uuid,text) owner to postgres;
revoke all on function internal.report_identity_check_unavailable(uuid,text) from public;
grant execute on function internal.report_identity_check_unavailable(uuid,text) to service_role;
