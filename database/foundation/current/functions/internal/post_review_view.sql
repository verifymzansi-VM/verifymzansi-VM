-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.post_review_view(p_post_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select jsonb_build_object('id', p.id, 'kind', p.kind, 'area', p.area, 'category', p.category_key,
    'activity', p.activity_key, 'status', p.status, 'revision', p.revision, 'edit_of', p.edit_of,
    'title', p.title, 'description', p.description, 'province', p.province_id, 'city', p.city_id,
    'locality', p.locality_label, 'submitted_at', p.submitted_at,
    'price_mode', l.price_mode, 'price_cents', l.price_cents::text, 'price_negotiable', l.price_negotiable,
    'attributes', l.attributes, 'starts_at', e.starts_at, 'ends_at', e.ends_at, 'timezone', e.timezone,
    'media', coalesce((select jsonb_agg(jsonb_build_object('purpose', pm.purpose, 'position', pm.position,
        'object_key', m.object_key, 'kind', m.kind, 'state', m.state, 'width', m.width, 'height', m.height)
        order by pm.purpose, pm.position)
      from private.post_media pm join private.media_objects m on m.id = pm.object_id where pm.post_id = p.id), '[]'))
  from private.posts p
  left join private.listing_details l on l.post_id = p.id
  left join private.event_details e on e.post_id = p.id
  where p.id = p_post_id;
$function$;
alter function internal.post_review_view(uuid) owner to postgres;
revoke all on function internal.post_review_view(uuid) from public;
