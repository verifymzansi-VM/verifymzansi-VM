-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.track_post_trial_funding()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare ent private.entitlements;
begin
  select e.* into ent from private.entitlements e where e.id=new.entitlement_id;
  if new.released_at is not null or not internal.entitlement_for_post_eligible(ent.id,new.post_id,new.owner_id) then
    return new; -- invalid/historical inserts cannot create a conversion proof
  end if;
  if ent.source='intro_trial' then
    insert into private.post_trial_claims(post_id,owner_id,trial_entitlement_id)
    values(new.post_id,new.owner_id,ent.id) on conflict(post_id) do nothing;
  elsif ent.source='retail_paid' and exists(select 1 from private.payments p
      where p.id=ent.payment_id and p.owner_id=ent.owner_id and p.status='complete') then
    update private.post_trial_claims set converted_at=clock_timestamp(),converted_by_activation_id=new.id
    where post_id=new.post_id and owner_id=new.owner_id and converted_at is null;
  end if;
  return new;
end;
$function$;
alter function internal.track_post_trial_funding() owner to postgres;
revoke all on function internal.track_post_trial_funding() from public;
