-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.org_update_affiliation(p_affiliation uuid, p_action text, p_value text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid; f private.organisation_affiliations; owner uuid;
begin
  select * into f from private.organisation_affiliations where id=p_affiliation;
  if not found then raise exception 'affiliation not found' using errcode='PT404',detail='affiliation_unavailable'; end if;
  actor:=internal.organisation_actor(f.organisation_id);
  select * into f from private.organisation_affiliations where id=f.id for update;
  actor:=internal.organisation_actor(f.organisation_id);
  if f.status<>'active' then
    raise exception 'affiliation is not active' using errcode='PT409',detail='affiliation_state'; end if;
  if p_action='revoke' then
    perform internal.organisation_reason(p_value);
    update private.organisation_affiliations set status='revoked',revoked_at=statement_timestamp(),revoked_by=actor,
      revoke_reason=p_value where id=f.id returning * into f;
    select p.owner_id into owner from private.posts p where p.id=f.post_id;
    perform internal.notify_account(owner,'organisation_affiliation_ended',f.id,f.post_id,f.organisation_id);
  elsif p_action='set_type' then
    if p_value is null or p_value not in('participant','member','affiliate') then
      raise exception 'unknown affiliation type' using errcode='22023',detail='affiliation_invalid'; end if;
    update private.organisation_affiliations set affiliation_type=p_value where id=f.id returning * into f;
  else
    raise exception 'unknown action' using errcode='22023',detail='affiliation_invalid';
  end if;
  perform internal.record_organisation_event(f.organisation_id,actor,'affiliation_'||p_action,f.id,
    case when p_action='revoke' then p_value end);
  return jsonb_build_object('id',f.id,'status',f.status,'affiliation_type',f.affiliation_type);
end;
$function$;
alter function internal.org_update_affiliation(uuid,text,text) owner to postgres;
revoke all on function internal.org_update_affiliation(uuid,text,text) from public;
grant execute on function internal.org_update_affiliation(uuid,text,text) to authenticated;
