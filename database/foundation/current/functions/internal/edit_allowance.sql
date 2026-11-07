-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.edit_allowance(p_post_id uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select coalesce((
    select greatest(2, 2 * ceil(extract(epoch from (e.ends_at - e.starts_at)) / 2592000.0))::integer
    from private.posts p
    join private.post_activations a on a.post_id = p.id and a.released_at is null
    join private.entitlements e on e.id = a.entitlement_id
    where p.id = p_post_id and p.kind <> 'event'
    order by e.ends_at desc limit 1), 2);
$function$;
alter function internal.edit_allowance(uuid) owner to postgres;
revoke all on function internal.edit_allowance(uuid) from public;
