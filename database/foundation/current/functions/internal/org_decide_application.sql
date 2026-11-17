-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.org_decide_application(p_application uuid, p_decision text, p_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid; a private.organisation_applications; o private.organisations; owner uuid; aff uuid;
begin
  select * into a from private.organisation_applications where id=p_application;
  if not found then raise exception 'request not found' using errcode='PT404',detail='application_unavailable'; end if;
  actor:=internal.organisation_actor(a.organisation_id);
  select * into o from private.organisations where id=a.organisation_id for share;
  select * into a from private.organisation_applications where id=a.id for update;
  actor:=internal.organisation_actor(a.organisation_id);
  if a.status not in('submitted','more_info_required') then
    raise exception 'request already decided' using errcode='PT409',detail='application_state'; end if;
  if o.programme_status in('suspended','ended') then
    raise exception 'this programme is not active' using errcode='PT409',detail='organisation_inactive'; end if;
  if p_note is not null and not internal.plain_text_valid(p_note,1,1000,true) then
    raise exception 'note is invalid' using errcode='22023',detail='application_invalid'; end if;
  select p.owner_id into owner from private.posts p where p.id=a.post_id;
  if p_decision='approve' then
    update private.organisation_applications set status='approved',decision_by=actor,decision_at=statement_timestamp(),
      decision_note=p_note,updated_at=statement_timestamp() where id=a.id;
    insert into private.organisation_affiliations(organisation_id,programme_id,post_id,application_id,confirmed_by)
      values(a.organisation_id,a.programme_id,a.post_id,a.id,actor)
      on conflict(organisation_id,post_id) where status='active' do nothing returning id into aff;
  elsif p_decision='decline' then
    update private.organisation_applications set status='declined',decision_by=actor,decision_at=statement_timestamp(),
      decision_note=p_note,updated_at=statement_timestamp() where id=a.id;
  elsif p_decision='request_info' then
    if p_note is null or not internal.plain_text_valid(p_note,5,1000,true) then
      raise exception 'describe the information required' using errcode='22023',detail='application_invalid'; end if;
    update private.organisation_applications set status='more_info_required',info_request=p_note,
      updated_at=statement_timestamp() where id=a.id;
  else
    raise exception 'unknown decision' using errcode='22023',detail='application_invalid';
  end if;
  perform internal.notify_account(owner,'organisation_application_decided',a.id,a.post_id,a.organisation_id);
  perform internal.record_organisation_event(a.organisation_id,actor,'application_'||p_decision,a.id,p_note);
  return jsonb_build_object('id',a.id,'decision',p_decision,'affiliation_id',aff);
end;
$function$;
alter function internal.org_decide_application(uuid,text,text) owner to postgres;
revoke all on function internal.org_decide_application(uuid,text,text) from public;
grant execute on function internal.org_decide_application(uuid,text,text) to authenticated;
