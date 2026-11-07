-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.addon_purchase_entitlement(p_owner uuid, p_post uuid, p_addon text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare target_area text; candidate uuid;
begin
  if p_owner is null or p_post is null or p_addon is null or p_addon not in('boost','featured','urgent') then return null; end if;
  select p.area into target_area from private.posts p where p.id=p_post and p.owner_id=p_owner;
  if not found then return null; end if;
  -- Owner/member indexes bound discovery. NOWAIT avoids mixed activation lock-order waits.
  for candidate in select e.id from private.entitlements e
    where e.id in(select owned.id from private.entitlements owned where owned.owner_id=p_owner and owned.status='active'
      union select m.entitlement_id from private.entitlement_members m where m.member_id=p_owner)
      and e.status='active' and (e.area is null or e.area=target_area)
      and p_addon=any(e.addon_capabilities) order by e.id
  loop
    begin
      perform e.id from private.entitlements e where e.id=candidate for update nowait;
    exception when lock_not_available then
      raise exception 'purchase capability is busy; retry the same operation' using errcode='PT409';
    end;
    -- Revalidate after preceding waits; busy entitlement rows require explicit retry.
    if exists(select 1 from private.entitlements e join private.posts p on p.id=p_post
      where e.id=candidate and p.owner_id=p_owner
        and internal.entitlement_for_post_eligible(e.id,p.id,p_owner)
        and p_addon=any(e.addon_capabilities)
        and not exists(select 1 from private.post_trial_claims c where c.post_id=p.id and c.converted_at is null)
        and (p_addon='urgent' or p.kind='event')
        and p.status='live' and p.published_at<=clock_timestamp() and p.visible_until>clock_timestamp()
        and exists(select 1 from private.public_eligible_posts visible where visible.id=p.id)
        and exists(select 1 from internal.post_funding(p.id) f where f.funded_until>clock_timestamp()))
    then return candidate; end if;
  end loop;
  return null;
end;
$function$;
alter function internal.addon_purchase_entitlement(uuid,uuid,text) owner to postgres;
revoke all on function internal.addon_purchase_entitlement(uuid,uuid,text) from public;
