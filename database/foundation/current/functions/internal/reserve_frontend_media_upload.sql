-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.reserve_frontend_media_upload(p_kind text, p_bytes integer, p_digest text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.price_draft_actor();object private.media_objects;reserved jsonb;
begin
  if p_digest is null or p_digest !~ '^[a-f0-9]{64}$' or p_kind is null or p_kind not in('image','video')
    or p_bytes is null or p_bytes<1 or p_bytes>(case when p_kind='image' then 5242880 else 52428800 end) then
    raise exception 'bounded inspected media required' using errcode='22023';end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text||':'||p_digest,2812));
  perform internal.price_draft_actor();
  select m.* into object from private.media_objects m where m.owner_id=actor and m.upload_digest=p_digest and m.state in('intent','ready') for update;
  if found then
    if object.kind<>p_kind or object.declared_bytes<>p_bytes then raise exception 'upload receipt changed' using errcode='PT409';end if;
  else
    reserved:=internal.begin_media_upload(p_kind,p_bytes);
    update private.media_objects set upload_digest=p_digest where id=(reserved->>'object_id')::uuid and owner_id=actor returning * into object;
  end if;
  perform internal.price_draft_actor();
  return jsonb_build_object('object_id',object.id,'object_key',object.object_key,'max_bytes',object.declared_bytes,'state',object.state,
    'kind',object.kind,'width',object.width,'height',object.height,'sha256',object.sha256,'size_bytes',object.size_bytes,'mime',object.mime);
end$function$;
alter function internal.reserve_frontend_media_upload(text,integer,text) owner to postgres;
revoke all on function internal.reserve_frontend_media_upload(text,integer,text) from public;
grant execute on function internal.reserve_frontend_media_upload(text,integer,text) to authenticated;
