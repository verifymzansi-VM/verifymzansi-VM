-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.update_my_application(p_application uuid, p_action text, p_response text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.price_draft_actor(); a private.organisation_applications;
begin
  select * into a from private.organisation_applications where id=p_application and applicant_id=actor for update;
  if not found then return null; end if;
  if p_action='respond' then
    if a.status<>'more_info_required' then
      raise exception 'no information was requested' using errcode='PT409',detail='application_state'; end if;
    if p_response is null or not internal.plain_text_valid(p_response,2,2000,true) then
      raise exception 'a response is required' using errcode='22023',detail='application_invalid'; end if;
    update private.organisation_applications set status='submitted',info_response=p_response,updated_at=statement_timestamp()
      where id=a.id returning * into a;
    perform internal.notify_account(x.account_id,'organisation_application_received',a.id,a.post_id,a.organisation_id)
      from private.organisation_admins x where x.organisation_id=a.organisation_id;
  elsif p_action='withdraw' then
    if a.status not in('submitted','more_info_required') then
      raise exception 'only open requests can be withdrawn' using errcode='PT409',detail='application_state'; end if;
    update private.organisation_applications set status='withdrawn',updated_at=statement_timestamp()
      where id=a.id returning * into a;
  else
    raise exception 'unknown action' using errcode='22023',detail='application_invalid';
  end if;
  return jsonb_build_object('id',a.id,'status',a.status);
end;
$function$;
alter function internal.update_my_application(uuid,text,text) owner to postgres;
revoke all on function internal.update_my_application(uuid,text,text) from public;
grant execute on function internal.update_my_application(uuid,text,text) to authenticated;
