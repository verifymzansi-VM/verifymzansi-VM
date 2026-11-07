-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.post_funding(p_post_id uuid)
 RETURNS TABLE(funded_until timestamp with time zone, max_photos integer, max_videos integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select e.ends_at, 10, 1
  from private.posts p join private.event_details e on e.post_id = p.id
  where p.id = p_post_id and p.kind = 'event'
  union all
  select e.ends_at, e.max_photos, e.max_videos
  from private.posts p
  join private.post_activations a on a.post_id = p.id and a.released_at is null and a.owner_id = p.owner_id
  join private.entitlements e on e.id = a.entitlement_id
  where p.id = p_post_id and p.kind <> 'event'
    and internal.entitlement_usable(e.status, e.starts_at, e.ends_at)
    and (e.area is null or e.area = p.area)
    and (e.owner_id = p.owner_id or exists (select 1 from private.entitlement_members m
      where m.entitlement_id = e.id and m.member_id = p.owner_id))
    and exists (select 1 from private.current_account_access u where u.id = e.owner_id)
    and (e.source <> 'retail_paid' or exists (select 1 from private.payments pay
      where pay.id = e.payment_id and pay.owner_id = e.owner_id and pay.status = 'complete'));
$function$;
alter function internal.post_funding(uuid) owner to postgres;
revoke all on function internal.post_funding(uuid) from public;
