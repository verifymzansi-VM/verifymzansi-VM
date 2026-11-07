-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.complete_frontend_media_upload(p_object_id uuid, p_size integer, p_sha256 text, p_mime text, p_width integer DEFAULT NULL::integer, p_height integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare object private.media_objects;result jsonb;
begin
  select m.* into object from private.media_objects m where m.id=p_object_id for update;
  if not found or not exists(select 1 from private.current_account_access a where a.id=object.owner_id) then
    raise exception 'active upload owner required' using errcode='42501';end if;
  if object.upload_digest is null or object.upload_digest is distinct from p_sha256 or object.declared_bytes is distinct from p_size then
    raise exception 'content-bound upload receipt required' using errcode='22023';end if;
  if object.state='ready' then
    if (object.sha256,object.size_bytes,object.mime,object.width,object.height) is distinct from (p_sha256,p_size,p_mime,p_width,p_height) then
      raise exception 'upload completion changed' using errcode='PT409';end if;
    result:=jsonb_build_object('object_id',object.id,'state','ready');
  elsif object.state='intent' then
    result:=internal.finalize_media(p_object_id,p_size,p_sha256,p_mime,p_width,p_height);
  else raise exception 'upload is no longer available' using errcode='PT409';end if;
  if not exists(select 1 from private.current_account_access a where a.id=object.owner_id) then
    raise exception 'upload owner is no longer active' using errcode='42501';end if;
  return result;
end$function$;
alter function internal.complete_frontend_media_upload(uuid,integer,text,text,integer,integer) owner to postgres;
revoke all on function internal.complete_frontend_media_upload(uuid,integer,text,text,integer,integer) from public;
grant execute on function internal.complete_frontend_media_upload(uuid,integer,text,text,integer,integer) to service_role;
