-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.add_organisation_note(p_org uuid, p_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('organisation:manage'); n private.organisation_notes;
begin
  begin
    insert into private.organisation_notes(organisation_id,author_id,note) values(p_org,actor,p_note) returning * into n;
  exception when check_violation or not_null_violation then
    raise exception 'note is invalid' using errcode='22023',detail='organisation_invalid';
  when foreign_key_violation then
    raise exception 'organisation not found' using errcode='PT404',detail='organisation_unavailable';
  end;
  return jsonb_build_object('id',n.id,'created_at',n.created_at);
end;
$function$;
alter function internal.add_organisation_note(uuid,text) owner to postgres;
revoke all on function internal.add_organisation_note(uuid,text) from public;
grant execute on function internal.add_organisation_note(uuid,text) to authenticated;
