-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.execute_frontend_organisation_action(p_org uuid, p_item uuid, p_action text, p_value text DEFAULT NULL::text, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.organisation_actor(p_org);result jsonb;
begin
  if p_action='decide' then
    if not exists(select 1 from private.organisation_applications a where a.id=p_item and a.organisation_id=p_org)
      then raise exception 'represented organisation application unavailable' using errcode='PT404',detail='application_unavailable';end if;
    result:=internal.org_decide_application(p_item,p_value,p_note);
  elsif p_action in('revoke','set_type','sponsor') then
    if not exists(select 1 from private.organisation_affiliations a where a.id=p_item and a.organisation_id=p_org)
      then raise exception 'represented affiliation unavailable' using errcode='PT404',detail='affiliation_unavailable';end if;
    if p_action='sponsor' then
      if p_value is null or p_value not in('founding','organisation') then raise exception 'valid funding source required' using errcode='22023',detail='sponsorship_invalid';end if;
      result:=internal.sponsor_business(p_item,p_note);
      if result->>'sponsor_type' is distinct from p_value
        then raise exception 'the current programme funding changed' using errcode='PT409',detail='programme_inactive';end if;
    else result:=internal.org_update_affiliation(p_item,p_action,p_value);end if;
  elsif p_action='end_sponsorship' then
    if not exists(select 1 from private.organisation_sponsorships s where s.id=p_item and s.organisation_id=p_org)
      then raise exception 'represented sponsorship unavailable' using errcode='PT404',detail='sponsorship_unavailable';end if;
    result:=internal.end_sponsorship(p_item,p_note);
  else raise exception 'valid organisation action required' using errcode='22023',detail='organisation_invalid';end if;
  perform internal.organisation_actor(p_org);return result;
end$function$;
alter function internal.execute_frontend_organisation_action(uuid,uuid,text,text,text) owner to postgres;
revoke all on function internal.execute_frontend_organisation_action(uuid,uuid,text,text,text) from public;
grant execute on function internal.execute_frontend_organisation_action(uuid,uuid,text,text,text) to authenticated;
