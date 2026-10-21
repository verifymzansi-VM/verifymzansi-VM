-- Public seller card on post detail: public name ("Thando D."), avatar and
-- the identity badge only. Never legal names, contact details, account ids or
-- verification evidence. Preserves the approved event schedule, price and
-- media projection of the previous definition.
do $public_seller_card_migration$
begin
create or replace function internal.get_public_post(p_id uuid)
returns jsonb language sql stable security definer set search_path = pg_catalog as $$
  select jsonb_build_object('id', p.id, 'kind', p.kind, 'area', p.area, 'category', p.category_key,
    'activity', p.activity_key, 'title', p.title, 'description', p.description, 'province', p.province_id,
    'city', p.city_id, 'locality', d.locality_label, 'price_mode', d.price_mode, 'price_cents', d.price_cents::text,
    'price_negotiable', d.price_negotiable,
    'published_at', p.published_at, 'visible_until', p.visible_until,
    'event_window',case when p.kind='event' then jsonb_build_object(
      'starts_at',to_char(e.starts_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'ends_at',to_char(e.ends_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'timezone',e.timezone) else null end,
    'condition', case when p.kind='listing' then d.facets->>'condition' end,
    'media', coalesce((select jsonb_agg(jsonb_build_object('purpose', pm.purpose, 'position', pm.position,
        'object_key', m.object_key, 'kind', m.kind, 'width', m.width, 'height', m.height,
        'focal_x', pm.focal_x, 'focal_y', pm.focal_y) order by pm.purpose, pm.position)
      from private.post_media pm join private.media_objects m on m.id = pm.object_id
      where pm.post_id = p.id and m.state = 'ready'), '[]'),
    'seller', jsonb_build_object(
      'public_name', internal.profile_public_name(pr.display_name),
      'avatar_object_key', (select m.object_key from private.media_objects m
        where m.id=pr.avatar_object_id and m.state='ready' and m.kind='image'),
      'identity_verified', exists(select 1 from private.accepted_identity_facts f
        where f.owner_id=p.owner_id and f.revoked_at is null)))
  from private.posts p join private.post_search_documents d on d.post_id = p.id
  left join private.event_details e on e.post_id=p.id and p.kind='event'
  left join private.profiles pr on pr.account_id=p.owner_id
  where p.id = p_id and d.is_visible and (d.visible_until is null or d.visible_until>statement_timestamp())
    and exists(select 1 from private.public_eligible_posts eligible where eligible.id=p.id);
$$;
revoke all on function internal.get_public_post(uuid) from public,anon,authenticated,service_role;
grant execute on function internal.get_public_post(uuid) to anon,authenticated;
perform pg_catalog.pg_notify('pgrst','reload schema');
end;
$public_seller_card_migration$;
