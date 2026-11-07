-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.edit_is_price_only(p_original_id uuid, p_edit_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select coalesce((
    select o.kind = 'listing'
      and (o.category_key, o.activity_key, o.title, o.description, o.province_id, o.city_id, o.locality_label)
        is not distinct from (e.category_key, e.activity_key, e.title, e.description, e.province_id, e.city_id, e.locality_label)
      and (to_jsonb(od) - array['post_id', 'price_mode', 'price_cents', 'price_negotiable'])
        = (to_jsonb(ed) - array['post_id', 'price_mode', 'price_cents', 'price_negotiable'])
      and (select c.channels from private.post_contacts c where c.post_id=o.id)
        is not distinct from (select c.channels from private.post_contacts c where c.post_id=e.id)
      and (od.price_mode, od.price_cents, od.price_negotiable) is distinct from (ed.price_mode, ed.price_cents, ed.price_negotiable)
      and coalesce((select jsonb_agg(to_jsonb(pm) - 'post_id' order by pm.purpose, pm.position)
             from private.post_media pm where pm.post_id = o.id), '[]')
        = coalesce((select jsonb_agg(to_jsonb(pm) - 'post_id' order by pm.purpose, pm.position)
             from private.post_media pm where pm.post_id = e.id), '[]')
    from private.posts o
    join private.posts e on e.id = p_edit_id and e.edit_of = o.id
    join private.listing_details od on od.post_id = o.id
    join private.listing_details ed on ed.post_id = e.id
    where o.id = p_original_id and internal.frontend_edit_presentation_same(p_original_id,p_edit_id)), false);
$function$;
alter function internal.edit_is_price_only(uuid,uuid) owner to postgres;
revoke all on function internal.edit_is_price_only(uuid,uuid) from public;
