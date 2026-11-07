-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.end_sponsorship(p_sponsorship uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid; s private.organisation_sponsorships;
begin
  perform internal.organisation_reason(p_reason);
  select * into s from private.organisation_sponsorships where id=p_sponsorship;
  if not found then raise exception 'sponsorship not found' using errcode='PT404',detail='sponsorship_unavailable'; end if;
  actor:=internal.organisation_actor(s.organisation_id);
  perform 1 from private.organisations o where o.id=s.organisation_id for update;
  actor:=internal.organisation_actor(s.organisation_id);
  if not exists(select 1 from private.organisation_sponsorships x where x.id=s.id and x.status in('active','waitlisted')) then
    raise exception 'sponsorship already ended' using errcode='PT409',detail='sponsorship_state'; end if;
  if internal.finish_sponsorship(s.id,'ended',p_reason,actor) then
    perform internal.fill_sponsorship_places(s.organisation_id); end if;
  actor:=internal.organisation_actor(s.organisation_id);
  perform internal.record_organisation_event(s.organisation_id,actor,'sponsorship_ended',s.id,p_reason);
  return jsonb_build_object('id',s.id,'status','ended');
end;
$function$;
alter function internal.end_sponsorship(uuid,text) owner to postgres;
revoke all on function internal.end_sponsorship(uuid,text) from public;
grant execute on function internal.end_sponsorship(uuid,text) to authenticated;
