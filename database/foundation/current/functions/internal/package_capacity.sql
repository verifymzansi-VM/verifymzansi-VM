-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.package_capacity(p_owner uuid, OUT posts integer, OUT post_media_bytes bigint)
 RETURNS record
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select coalesce(sum(e.slot_capacity), 0)::integer,
    greatest(104857600, coalesce(max(e.max_photos::bigint * 5242880 + e.max_videos::bigint * 52428800), 0))
  from private.entitlements e
  where internal.entitlement_usable(e.status, e.starts_at, e.ends_at)
    and (e.owner_id = p_owner or exists (select 1 from private.entitlement_members m
      where m.entitlement_id = e.id and m.member_id = p_owner))
    and exists(select 1 from private.current_account_access u where u.id=e.owner_id)
    and (e.source<>'retail_paid' or exists(select 1 from private.payments pay
      where pay.id=e.payment_id and pay.owner_id=e.owner_id and pay.status='complete'));
$function$;
alter function internal.package_capacity(uuid) owner to postgres;
revoke all on function internal.package_capacity(uuid) from public;
