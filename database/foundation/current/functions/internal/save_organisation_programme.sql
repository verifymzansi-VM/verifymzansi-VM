-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.save_organisation_programme(p_org uuid, p_slug text, p_name text, p_description text, p_active boolean, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('organisation:manage'); pr private.organisation_programmes;
begin
  perform internal.organisation_reason(p_reason);
  perform 1 from private.organisations where id=p_org for update;
  if not found then raise exception 'organisation not found' using errcode='PT404',detail='organisation_unavailable'; end if;
  begin
    insert into private.organisation_programmes(organisation_id,slug,name,description,active)
      values(p_org,p_slug,p_name,p_description,coalesce(p_active,true))
    on conflict(organisation_id,slug) do update set name=excluded.name,description=excluded.description,
      active=excluded.active
    returning * into pr;
  exception when check_violation or not_null_violation then
    raise exception 'programme details are invalid' using errcode='22023',detail='organisation_invalid';
  end;
  perform internal.record_organisation_event(p_org,actor,'programme_saved',pr.id,p_reason);
  return jsonb_build_object('id',pr.id,'slug',pr.slug,'active',pr.active);
end;
$function$;
alter function internal.save_organisation_programme(uuid,text,text,text,boolean,text) owner to postgres;
revoke all on function internal.save_organisation_programme(uuid,text,text,text,boolean,text) from public;
grant execute on function internal.save_organisation_programme(uuid,text,text,text,boolean,text) to authenticated;
