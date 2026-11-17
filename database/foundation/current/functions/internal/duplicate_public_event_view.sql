-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.duplicate_public_event_view(p_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select jsonb_build_object('id',p.id,'revision',p.revision,'title',p.title,
    'description',p.description,'category',p.category_key,'activity',p.activity_key,
    'province',p.province_id,'city',p.city_id,
    'locality',coalesce(p.locality_label,(select c.label from private.cities c where c.id=p.city_id)),
    'event_window',jsonb_build_object(
      'starts_at',to_char(e.starts_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'ends_at',to_char(e.ends_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'timezone',e.timezone))
  from private.posts p join private.event_details e on e.post_id=p.id
  where p.id=p_id and p.kind='event' and p.edit_of is null
    and p.visible_until>clock_timestamp() and e.ends_at>clock_timestamp()
    and exists(select 1 from private.public_eligible_posts eligible where eligible.id=p.id);
$function$;
alter function internal.duplicate_public_event_view(uuid) owner to postgres;
revoke all on function internal.duplicate_public_event_view(uuid) from public;
