-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.complete_frontend_video_upload(p_object_id uuid, p_size integer, p_sha256 text, p_mime text, p_duration_ms integer, p_facts jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare object private.media_objects;result jsonb;
begin
  if p_duration_ms is null or p_duration_ms not between 1 and 120999 then
    raise exception 'video length outside the limit' using errcode='22023',detail='video_length_invalid';end if;
  if p_facts is not null and (jsonb_typeof(p_facts)<>'object' or pg_column_size(p_facts)>512
      or exists(select 1 from jsonb_each(p_facts) f where not (
        (f.key in ('codec','audio') and jsonb_typeof(f.value)='string' and length(f.value#>>'{}') between 1 and 8)
        or (f.key in ('profile','level','width','height') and case when jsonb_typeof(f.value)='number'
          then f.value::numeric between 0 and 20000 and f.value::numeric%1=0 else false end)
        or (f.key='fps' and case when jsonb_typeof(f.value)='number'
          then f.value::numeric between 0 and 1000 else false end)
        or (f.key='faststart' and jsonb_typeof(f.value)='boolean')
        or (f.key='problem' and (jsonb_typeof(f.value)='null'
          or (jsonb_typeof(f.value)='string' and length(f.value#>>'{}') between 1 and 20)))
        or (f.key='source' and jsonb_typeof(f.value)='string' and f.value#>>'{}' in ('kept','remuxed','converted'))))) then
    raise exception 'video facts invalid' using errcode='22023',detail='video_facts_invalid';end if;
  select m.* into object from private.media_objects m where m.id=p_object_id for update;
  if not found or object.kind<>'video' then
    raise exception 'video upload required' using errcode='22023';end if;
  if object.duration_ms is not null and object.duration_ms<>p_duration_ms then
    raise exception 'upload completion changed' using errcode='PT409';end if;
  -- Owner, receipt, digest and replay checks are the media completion's own.
  result:=internal.complete_frontend_media_upload(p_object_id,p_size,p_sha256,p_mime,null,null);
  if result->>'state'='ready' then
    -- The first facts stay: a replay may add them, never change them.
    update private.media_objects set duration_ms=coalesce(duration_ms,p_duration_ms),
        video_facts=coalesce(video_facts,p_facts)
      where id=object.id and (duration_ms is null or (video_facts is null and p_facts is not null));
  end if;
  return result;
end$function$;
alter function internal.complete_frontend_video_upload(uuid,integer,text,text,integer,jsonb) owner to postgres;
revoke all on function internal.complete_frontend_video_upload(uuid,integer,text,text,integer,jsonb) from public;
grant execute on function internal.complete_frontend_video_upload(uuid,integer,text,text,integer,jsonb) to service_role;
