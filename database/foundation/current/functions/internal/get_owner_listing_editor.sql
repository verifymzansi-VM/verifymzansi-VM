-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.get_owner_listing_editor(p_post_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.price_draft_actor(); result jsonb;
begin
  select jsonb_build_object(
    'id',p.id,'kind',p.kind,'area',p.area,'category_key',p.category_key,
    'status',p.status,'revision',p.revision,'edit_of',p.edit_of,
    'content',jsonb_build_object('title',p.title,'description',p.description,
      'province_id',p.province_id,'city_id',p.city_id,'locality_label',p.locality_label),
    'terms',jsonb_build_object('price_mode',d.price_mode,'price_cents',d.price_cents,
      'price_negotiable',d.price_negotiable),
    'attributes_version',d.attributes_version,'attributes',d.attributes,
    'media',coalesce((select jsonb_agg(jsonb_build_object(
        'object_id',m.id,'kind',m.kind,'state',m.state,
        'purpose',pm.purpose,'position',pm.position,'width',m.width,'height',m.height,
        'focal_x',pm.focal_x,'focal_y',pm.focal_y) order by pm.purpose,pm.position)
      from private.post_media pm join private.media_objects m on m.id=pm.object_id
      where pm.post_id=p.id and m.owner_id=actor),'[]'::jsonb)
  ) into result
  from private.posts p join private.listing_details d on d.post_id=p.id
  where p.id=p_post_id and p.owner_id=actor and p.kind='listing' and p.area='market'
    and p.category_key in ('property','vehicles','auto_parts','electronics','home_lifestyle',
      'jobs_services','farming_agriculture','baby_kids','clothing_accessories','sports_hobbies','other_items');
  -- Authority is current, never inferred from DTO status or editable metadata.
  perform internal.price_draft_actor();
  return result;
end;
$function$;
alter function internal.get_owner_listing_editor(uuid) owner to postgres;
revoke all on function internal.get_owner_listing_editor(uuid) from public;
grant execute on function internal.get_owner_listing_editor(uuid) to authenticated;
