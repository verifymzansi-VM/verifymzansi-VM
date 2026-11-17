-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.finalize_media(p_object_id uuid, p_size integer, p_sha256 text, p_mime text, p_width integer, p_height integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare obj private.media_objects; ok boolean;
begin
  select * into obj from private.media_objects m where m.id = p_object_id for update;
  if not found or obj.state <> 'intent' then raise exception 'upload not pending' using errcode = '22023'; end if;
  ok := p_size between 1 and obj.declared_bytes and p_sha256 ~ '^[a-f0-9]{64}$'
    and ((obj.kind = 'image' and p_mime in ('image/jpeg', 'image/png', 'image/webp', 'image/avif')
          and p_width between 1 and 20000 and p_height between 1 and 20000)
      or (obj.kind = 'video' and p_mime in ('video/mp4', 'video/webm')));
  if ok then
    update private.media_objects set state = 'ready', size_bytes = p_size, sha256 = p_sha256, mime = p_mime,
      width = p_width, height = p_height where id = obj.id;
  else
    update private.media_objects set state = 'rejected',
      size_bytes = case when p_size > 0 then p_size else null end where id = obj.id;
  end if;
  return jsonb_build_object('object_id', obj.id, 'state', case when ok then 'ready' else 'rejected' end);
end;
$function$;
alter function internal.finalize_media(uuid,integer,text,text,integer,integer) owner to postgres;
revoke all on function internal.finalize_media(uuid,integer,text,text,integer,integer) from public;
grant execute on function internal.finalize_media(uuid,integer,text,text,integer,integer) to service_role;
