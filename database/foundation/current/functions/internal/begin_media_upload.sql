-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.begin_media_upload(p_kind text, p_bytes integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid := internal.price_draft_actor(); used bigint; obj private.media_objects;
begin
  if p_kind is null or p_kind not in ('image', 'video') or p_bytes is null or p_bytes < 1
    or (p_kind = 'image' and p_bytes > 5242880) or (p_kind = 'video' and p_bytes > 52428800) then
    raise exception 'images up to 5 MB, videos up to 50 MB' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text, 808));
  if (select count(*) from private.media_objects m where m.owner_id = actor and m.state = 'intent') >= 20 then
    raise exception 'too many unfinished uploads' using errcode = 'PT429';
  end if;
  select coalesce(sum(greatest(coalesce(m.size_bytes, 0), m.declared_bytes)), 0) into used
  from private.media_objects m where m.owner_id = actor and m.state <> 'deleted';
  if used + p_bytes > internal.media_storage_allowance(actor) then
    raise exception 'storage for your package is full; delete unused posts or drafts' using errcode = 'PT409';
  end if;
  insert into private.media_objects (owner_id, kind, object_key, declared_bytes)
  values (actor, p_kind, 'media/' || pg_catalog.gen_random_uuid(), p_bytes)
  returning * into obj;
  perform internal.price_draft_actor(); -- final live owner/session check after all waits
  return jsonb_build_object('object_id', obj.id, 'object_key', obj.object_key, 'max_bytes', obj.declared_bytes);
end;
$function$;
alter function internal.begin_media_upload(text,integer) owner to postgres;
revoke all on function internal.begin_media_upload(text,integer) from public;
grant execute on function internal.begin_media_upload(text,integer) to authenticated;
