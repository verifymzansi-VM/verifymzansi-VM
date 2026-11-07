-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.entitlement_for_post_eligible(p_ent uuid, p_post uuid, p_owner uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  return exists(select 1 from private.entitlements e join private.posts p on p.id=p_post
    where e.id=p_ent and p.owner_id=p_owner
      and e.status='active' and e.starts_at<=clock_timestamp() and e.ends_at>clock_timestamp()
      and (e.area is null or e.area=p.area)
      and (e.owner_id=p_owner or exists(select 1 from private.entitlement_members m
        where m.entitlement_id=e.id and m.member_id=p_owner))
      and exists(select 1 from private.current_account_access u where u.id=p_owner)
      and exists(select 1 from private.current_account_access u where u.id=e.owner_id)
      and (e.source<>'retail_paid' or exists(select 1 from private.payments pay
        where pay.id=e.payment_id and pay.owner_id=e.owner_id and pay.status='complete')));
end;
$function$;
alter function internal.entitlement_for_post_eligible(uuid,uuid,uuid) owner to postgres;
revoke all on function internal.entitlement_for_post_eligible(uuid,uuid,uuid) from public;
