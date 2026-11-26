-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.complete_frontend_video_upload(p_object_id uuid, p_size integer, p_sha256 text, p_mime text, p_duration_ms integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare object private.media_objects;result jsonb;
begin
  if p_duration_ms is null or p_duration_ms not between 1 and 120999 then
    raise exception 'video length outside the limit' using errcode='22023',detail='video_length_invalid';end if;
  select m.* into object from private.media_objects m where m.id=p_object_id for update;
  if not found or object.kind<>'video' then
    raise exception 'video upload required' using errcode='22023';end if;
  if object.duration_ms is not null and object.duration_ms<>p_duration_ms then
    raise exception 'upload completion changed' using errcode='PT409';end if;
  -- Owner, receipt, digest and replay checks are the media completion's own.
  result:=internal.complete_frontend_media_upload(p_object_id,p_size,p_sha256,p_mime,null,null);
  if result->>'state'='ready' then
    update private.media_objects set duration_ms=p_duration_ms where id=object.id and duration_ms is null;
  end if;
  return result;
end$function$;
alter function internal.complete_frontend_video_upload(uuid,integer,text,text,integer) owner to postgres;
revoke all on function internal.complete_frontend_video_upload(uuid,integer,text,text,integer) from public;
grant execute on function internal.complete_frontend_video_upload(uuid,integer,text,text,integer) to service_role;
