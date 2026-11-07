-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.create_organisation(p_slug text, p_name text, p_type text, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('organisation:manage'); o private.organisations;
begin
  perform internal.organisation_reason(p_reason);
  begin
    insert into private.organisations(slug,name,organisation_type,created_by) values(p_slug,p_name,p_type,actor)
      returning * into o;
  exception when check_violation or not_null_violation then
    raise exception 'organisation details are invalid' using errcode='22023',detail='organisation_invalid';
  when unique_violation then
    raise exception 'that address is already used' using errcode='PT409',detail='organisation_slug_taken';
  end;
  perform internal.record_organisation_event(o.id,actor,'organisation_created',o.id,p_reason);
  return jsonb_build_object('id',o.id,'slug',o.slug,'revision',o.revision);
end;
$function$;
alter function internal.create_organisation(text,text,text,text) owner to postgres;
revoke all on function internal.create_organisation(text,text,text,text) from public;
grant execute on function internal.create_organisation(text,text,text,text) to authenticated;
