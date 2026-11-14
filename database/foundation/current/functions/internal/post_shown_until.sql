-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.post_shown_until(p_post_id uuid, p_kind text, p_visible_until timestamp with time zone)
 RETURNS timestamp with time zone
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select case when p_kind = 'event' or p_visible_until is null then p_visible_until
    else coalesce((select internal.slot_chain_end(a.entitlement_id) from private.post_activations a
        join private.entitlements e on e.id = a.entitlement_id
      where a.post_id = p_post_id and a.released_at is null and e.status = 'active'), p_visible_until) end;
$function$;
alter function internal.post_shown_until(uuid,text,timestamp with time zone) owner to postgres;
revoke all on function internal.post_shown_until(uuid,text,timestamp with time zone) from public;
