-- Content-bound reservations make the existing upload retry safe. The digest
-- identifies inspected/normalized public media, not identity-document data.
begin;
create function internal.resolve_my_frontend_media(p_keys text[] default null,p_ids uuid[] default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.price_draft_actor();result jsonb;
begin
  if coalesce(cardinality(p_keys),0)+coalesce(cardinality(p_ids),0)>80
    or coalesce(array_ndims(p_keys),1)<>1 or coalesce(array_ndims(p_ids),1)<>1
    or array_position(p_keys,null) is not null or array_position(p_ids,null) is not null
    or exists(select 1 from unnest(p_keys) k where k !~ '^media/[a-f0-9]{8}-([a-f0-9]{4}-){3}[a-f0-9]{12}$') then
    raise exception 'bounded owned media references required' using errcode='22023';end if;
  if exists(select 1 from unnest(p_keys) k where not exists(select 1 from private.media_objects m where m.object_key=k and m.owner_id=actor and m.state='ready'))
    or exists(select 1 from unnest(p_ids) i where not exists(select 1 from private.media_objects m where m.id=i and m.owner_id=actor and m.state='ready')) then
    raise exception 'upload unavailable' using errcode='22023';end if;
  select coalesce(jsonb_agg(jsonb_build_object('object_id',m.id,'object_key',m.object_key,'kind',m.kind,'state',m.state) order by m.id),'[]'::jsonb) into result
    from private.media_objects m where m.owner_id=actor and m.state='ready' and (m.object_key=any(p_keys) or m.id=any(p_ids));
  perform internal.price_draft_actor();return result;
end$$;
revoke all on function internal.resolve_my_frontend_media(text[],uuid[]) from public,anon,authenticated,service_role;
grant execute on function internal.resolve_my_frontend_media(text[],uuid[]) to authenticated;
create function api.resolve_my_frontend_media(p_keys text[] default null,p_ids uuid[] default null) returns jsonb language sql security invoker set search_path=pg_catalog as $$select internal.resolve_my_frontend_media(p_keys,p_ids)$$;
revoke all on function api.resolve_my_frontend_media(text[],uuid[]) from public,anon,authenticated,service_role;
grant execute on function api.resolve_my_frontend_media(text[],uuid[]) to authenticated;
alter table private.media_objects add column upload_digest text check(upload_digest ~ '^[a-f0-9]{64}$');
create unique index media_objects_upload_digest_idx on private.media_objects(owner_id,upload_digest)
  where upload_digest is not null and state in('intent','ready');
create function internal.reserve_frontend_media_upload(p_kind text,p_bytes integer,p_digest text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
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
end$$;
revoke all on function internal.reserve_frontend_media_upload(text,integer,text) from public,anon,authenticated,service_role;
grant execute on function internal.reserve_frontend_media_upload(text,integer,text) to authenticated;
create function api.reserve_frontend_media_upload(p_kind text,p_bytes integer,p_digest text) returns jsonb language sql security invoker set search_path=pg_catalog as $$select internal.reserve_frontend_media_upload(p_kind,p_bytes,p_digest)$$;
revoke all on function api.reserve_frontend_media_upload(text,integer,text) from public,anon,authenticated,service_role;
grant execute on function api.reserve_frontend_media_upload(text,integer,text) to authenticated;

create function internal.complete_frontend_media_upload(p_object_id uuid,p_size integer,p_sha256 text,p_mime text,p_width integer default null,p_height integer default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
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
end$$;
revoke all on function internal.complete_frontend_media_upload(uuid,integer,text,text,integer,integer) from public,anon,authenticated,service_role;
grant execute on function internal.complete_frontend_media_upload(uuid,integer,text,text,integer,integer) to service_role;
create function api.complete_frontend_media_upload(p_object_id uuid,p_size integer,p_sha256 text,p_mime text,p_width integer default null,p_height integer default null)
returns jsonb language sql security invoker set search_path=pg_catalog as $$select internal.complete_frontend_media_upload(p_object_id,p_size,p_sha256,p_mime,p_width,p_height)$$;
revoke all on function api.complete_frontend_media_upload(uuid,integer,text,text,integer,integer) from public,anon,authenticated,service_role;
grant execute on function api.complete_frontend_media_upload(uuid,integer,text,text,integer,integer) to service_role;
notify pgrst,'reload schema';
commit;
