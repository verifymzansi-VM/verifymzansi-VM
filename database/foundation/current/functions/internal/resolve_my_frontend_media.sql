-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.resolve_my_frontend_media(p_keys text[] DEFAULT NULL::text[], p_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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
end$function$;
alter function internal.resolve_my_frontend_media(text[],uuid[]) owner to postgres;
revoke all on function internal.resolve_my_frontend_media(text[],uuid[]) from public;
grant execute on function internal.resolve_my_frontend_media(text[],uuid[]) to authenticated;
