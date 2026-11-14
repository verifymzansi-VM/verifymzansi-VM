-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.slot_posts_started(p_entitlement uuid, p_since timestamp with time zone)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select count(*)::integer from private.post_activations a
  where a.activated_at > p_since and a.release_reason is distinct from 'moderation' and not a.continued
    and a.entitlement_id in (select c.id from private.entitlements t
    join private.entitlements c on c.id = coalesce(t.slot_id, t.id) or c.slot_id = coalesce(t.slot_id, t.id)
    where t.id = p_entitlement);
$function$;
alter function internal.slot_posts_started(uuid,timestamp with time zone) owner to postgres;
revoke all on function internal.slot_posts_started(uuid,timestamp with time zone) from public;
