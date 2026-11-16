-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.slot_package_leaving(p_package uuid)
 RETURNS TABLE(activation_id uuid, post_id uuid, place_rank bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select a.id, a.post_id, row_number() over (order by p.published_at desc nulls last, a.id)
  from private.entitlements e
    join private.post_activations a on a.entitlement_id = e.id and a.released_at is null and a.post_id is not null
    join private.posts p on p.id = a.post_id
  where e.package_id = p_package and e.status = 'active' and e.ends_at > statement_timestamp()
    and e.ends_at <= statement_timestamp() + interval '7 days';
$function$;
alter function internal.slot_package_leaving(uuid) owner to postgres;
revoke all on function internal.slot_package_leaving(uuid) from public;
