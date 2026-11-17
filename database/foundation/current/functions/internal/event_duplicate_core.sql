-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.event_duplicate_core(p_post_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select jsonb_build_array(internal.event_duplicate_text(p.title),internal.event_duplicate_text(p.description),
    p.category_key,p.activity_key,p.province_id,p.city_id,
    internal.event_duplicate_text(coalesce(p.locality_label,(select c.label from private.cities c where c.id=p.city_id))),
    to_char(e.starts_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    to_char(e.ends_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
  from private.posts p join private.event_details e on e.post_id=p.id where p.id=p_post_id and p.kind='event';
$function$;
alter function internal.event_duplicate_core(uuid) owner to postgres;
revoke all on function internal.event_duplicate_core(uuid) from public;
