-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.set_organisation_logo(p_id uuid, p_expected_revision integer, p_object_id uuid, p_permission_reference text, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('organisation:manage'); o private.organisations;
begin
  perform internal.organisation_reason(p_reason);
  if (p_object_id is null)<>(p_permission_reference is null)
    or (p_permission_reference is not null and not internal.plain_text_valid(p_permission_reference,3,200,false)) then
    raise exception 'logo and written permission go together' using errcode='22023',detail='organisation_invalid'; end if;
  select * into o from private.organisations where id=p_id for update;
  if not found then raise exception 'organisation not found' using errcode='PT404',detail='organisation_unavailable'; end if;
  if p_object_id is not null then
    perform 1 from private.media_objects m where m.id=p_object_id and m.owner_id=actor and m.kind='image'
      and m.state='ready' for update;
    if not found then raise exception 'your own ready image is required' using errcode='22023',detail='logo_unavailable'; end if;
  end if;
  actor:=internal.staff_actor('organisation:manage');
  if o.revision<>p_expected_revision then
    raise exception 'organisation changed; reload it' using errcode='PT409',detail='organisation_changed'; end if;
  if o.logo_object_id is not null and o.logo_object_id is distinct from p_object_id then
    update private.media_objects set unlinked_at=statement_timestamp() where id=o.logo_object_id; end if;
  update private.organisations set logo_object_id=p_object_id,
    logo_permission_at=case when p_object_id is null then null else statement_timestamp() end,
    logo_permission_by=case when p_object_id is null then null else actor end,
    logo_permission_reference=p_permission_reference,revision=revision+1,updated_at=statement_timestamp()
  where id=o.id returning * into o;
  perform internal.record_organisation_event(o.id,actor,'organisation_logo_set',p_object_id,p_reason);
  return jsonb_build_object('id',o.id,'slug',o.slug,'revision',o.revision);
end;
$function$;
alter function internal.set_organisation_logo(uuid,integer,uuid,text,text) owner to postgres;
revoke all on function internal.set_organisation_logo(uuid,integer,uuid,text,text) from public;
grant execute on function internal.set_organisation_logo(uuid,integer,uuid,text,text) to authenticated;
