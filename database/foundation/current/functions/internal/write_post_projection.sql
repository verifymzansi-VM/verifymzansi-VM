-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.write_post_projection(p_post_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare post private.posts; price record; public_facets jsonb := '{}'::jsonb;
begin
  select * into post from private.posts p where p.id = p_post_id;
  select d.price_mode, d.price_cents, d.price_negotiable into price from private.listing_details d where d.post_id = post.id;
  if post.kind = 'listing' then
    select coalesce(jsonb_object_agg(f.key, d.attributes->f.key), '{}'::jsonb) into public_facets
    from private.category_fields f join private.listing_details d on d.post_id = post.id
    where f.category_key = post.category_key and f.facet_kind is not null and d.attributes ? f.key;
  end if;
  insert into private.post_search_documents (post_id, kind, area, category_key, activity_key, province_id, city_id,
    locality_label, title, summary, price_mode, price_cents, price_negotiable, published_at, visible_until, is_visible, facets)
  values (post.id, post.kind, post.area, post.category_key, post.activity_key, post.province_id, post.city_id,
    coalesce(post.locality_label, (select c.label from private.cities c where c.id = post.city_id)),
    post.title, left(coalesce(post.description, ''), 300), price.price_mode,
    case when price.price_mode = 'on_request' then null else price.price_cents end,
    coalesce(price.price_negotiable,false),
    post.published_at, post.visible_until, post.status = 'live', public_facets)
  on conflict (post_id) do update set kind = excluded.kind, area = excluded.area,
    category_key = excluded.category_key, activity_key = excluded.activity_key, province_id = excluded.province_id,
    city_id = excluded.city_id, locality_label = excluded.locality_label, title = excluded.title,
    summary = excluded.summary, price_mode = excluded.price_mode, price_cents = excluded.price_cents, price_negotiable = excluded.price_negotiable,
    published_at = excluded.published_at, visible_until = excluded.visible_until, is_visible = excluded.is_visible,
    facets = excluded.facets;
end;
$function$;
alter function internal.write_post_projection(uuid) owner to postgres;
revoke all on function internal.write_post_projection(uuid) from public;
