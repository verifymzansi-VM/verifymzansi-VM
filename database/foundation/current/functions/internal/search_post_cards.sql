-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.search_post_cards(p_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare result jsonb; cards jsonb; presentation boolean:=false; frontend boolean:=false;
begin
  if p_request ? 'presentation' then
    if jsonb_typeof(p_request->'presentation') is distinct from 'boolean' then
      raise exception 'invalid presentation option' using errcode='22023';
    end if;
    presentation := (p_request->>'presentation')::boolean;
  end if;
  if p_request ? 'frontend_presentation' then
      if jsonb_typeof(p_request->'frontend_presentation') is distinct from 'boolean' then raise exception 'invalid frontend presentation option' using errcode='22023'; end if;
      frontend:=(p_request->>'frontend_presentation')::boolean;
    end if;
    if frontend and not presentation then raise exception 'presentation option required' using errcode='22023'; end if;
    result := internal.search_posts(p_request-array['presentation','frontend_presentation']);
  select coalesce(jsonb_agg(item.value||jsonb_build_object('preview',jsonb_build_object(
    'image_key',(select m.object_key from private.post_media pm join private.media_objects m on m.id=pm.object_id
      where pm.post_id=(item.value->>'id')::uuid and m.state='ready' and m.kind='image'
      order by (pm.purpose='cover') desc,pm.position limit 1),
    'video_key',(select m.object_key from private.post_media pm join private.media_objects m on m.id=pm.object_id
      where pm.post_id=(item.value->>'id')::uuid and m.state='ready' and m.kind='video' order by pm.position limit 1)
  )) || case when presentation then jsonb_build_object('presentation',jsonb_build_object(
    'business_type',(select b.business_type from private.business_details b where b.post_id=(item.value->>'id')::uuid),
    'event_window',(select jsonb_build_object(
      'starts_at',to_char(e.starts_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'ends_at',to_char(e.ends_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'timezone',e.timezone) from private.event_details e where e.post_id=(item.value->>'id')::uuid)
  ) || case when frontend then jsonb_build_object('frontend',internal.frontend_post_presentation((item.value->>'id')::uuid)) else '{}'::jsonb end) else '{}'::jsonb end order by item.ordinality),'[]'::jsonb) into cards
  from jsonb_array_elements(result->'items') with ordinality item(value,ordinality);
  return jsonb_set(result,'{items}',cards) || case when presentation then jsonb_build_object('presentation_contract','restored-public-v1') else '{}'::jsonb end;
end;
$function$;
alter function internal.search_post_cards(jsonb) owner to postgres;
revoke all on function internal.search_post_cards(jsonb) from public;
grant execute on function internal.search_post_cards(jsonb) to anon;
grant execute on function internal.search_post_cards(jsonb) to authenticated;
