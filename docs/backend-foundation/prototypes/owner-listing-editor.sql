-- Owner listing editor restore. Additive local prototype; not release approval.
-- One bounded snapshot replaces separate content/price/attribute/media reads.
-- This DTO grants no edit, publication, funding or document access capability.
create function internal.get_owner_listing_editor(p_post_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
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
$$;
revoke all on function internal.get_owner_listing_editor(uuid) from public,anon,authenticated,service_role;
grant execute on function internal.get_owner_listing_editor(uuid) to authenticated;
create function api.get_owner_listing_editor(p_post_id uuid)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.get_owner_listing_editor(p_post_id);
$$;
revoke all on function api.get_owner_listing_editor(uuid) from public,anon,authenticated,service_role;
grant execute on function api.get_owner_listing_editor(uuid) to authenticated;
