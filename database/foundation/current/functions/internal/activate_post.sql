-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.activate_post(p_post_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  actor uuid := internal.price_draft_actor();
  post private.posts;
  current_activation private.post_activations;
  ent private.entitlements;
  used integer;
  any_usable boolean := false;
  places integer;
  posts_limit integer;
begin
  select * into post from private.posts p where p.id = p_post_id and p.owner_id = actor for update;
  if not found then raise exception 'post not found' using errcode = '22023'; end if;
  select * into current_activation from private.post_activations a where a.post_id = post.id and a.released_at is null;
  if found then
    select * into ent from private.entitlements e where e.id = current_activation.entitlement_id for update;
    if internal.entitlement_for_post_eligible(ent.id,post.id,actor) then
      perform internal.price_draft_actor(); -- final live owner/session check after all waits
  return jsonb_build_object('activation_id', current_activation.id, 'entitlement_id', ent.id, 'reused', true);
    end if;
    update private.post_activations set released_at = statement_timestamp(), release_reason = 'entitlement_ended'
      where id = current_activation.id;
  end if;
  for ent in
    select e.* from private.entitlements e
    where internal.entitlement_usable(e.status, e.starts_at, e.ends_at)
      and (e.area is null or e.area = post.area)
      and (e.owner_id = actor or exists (select 1 from private.entitlement_members m
        where m.entitlement_id = e.id and m.member_id = actor))
      and exists(select 1 from private.current_account_access u where u.id=e.owner_id)
      and (e.source<>'retail_paid' or exists(select 1 from private.payments pay
        where pay.id=e.payment_id and pay.owner_id=e.owner_id and pay.status='complete'))
    -- A Multi-listing package's places first (20261114154823, E3): an
    -- Individual slot beside it is often about to end. In the package's last
    -- 7 days, Individual slots bought to go below 5 come first (decision 11).
    order by case when e.package_id is not null and e.ends_at > statement_timestamp() + interval '7 days' then 0
        when e.package_id is null then 1 else 2 end, e.ends_at, e.id
    for update
  loop
    -- Cursor predicates may predate a row wait; re-read all authority and wall time.
    continue when not internal.entitlement_for_post_eligible(ent.id,post.id,actor);
    any_usable := true;
    if ent.package_id is not null then
      -- A package's places are shared by all its grants: one activation at a
      -- time (the package row). The posts in it and the posts of the owner's
      -- ended Individual slots it takes fill them (internal.slot_posts_held);
      -- the 4 posts going live per place per rolling 30 days count over the
      -- whole package (decision 10), a post moved in not counting.
      perform 1 from private.slot_packages k where k.id = ent.package_id for update;
      select n.places, n.new_posts_limit into places, posts_limit from internal.slot_package_now(ent.owner_id) n
        where n.package_id = ent.package_id;
      continue when places is null;
      continue when internal.slot_posts_held(ent.id) >= places;
      continue when internal.slot_posts_started(ent.id,
        statement_timestamp() - make_interval(days => ent.activation_period_days)) >= posts_limit;
    else
      -- A slot's posts over all its periods: a post still in the period that
      -- just ended (waiting to move to this one) fills the slot.
      select count(*) into used from private.post_activations a where a.released_at is null
        and a.entitlement_id in (select c.id from private.entitlements c
          where c.id = coalesce(ent.slot_id, ent.id) or c.slot_id = coalesce(ent.slot_id, ent.id));
      continue when used >= ent.slot_capacity;
      if ent.activations_per_period is not null then
        -- Posts going live in the rolling period, over every period of the
        -- slot (a renewal does not restart the count): a new post and an ended
        -- post brought back each count; a submission that review rejected does
        -- not, nor a post moved on into a renewed period.
        select count(*) into used from private.post_activations a
          where a.entitlement_id in (select c.id from private.entitlements c
              where c.id = coalesce(ent.slot_id, ent.id) or c.slot_id = coalesce(ent.slot_id, ent.id))
            and a.activated_at > statement_timestamp() - make_interval(days => ent.activation_period_days)
            and a.release_reason is distinct from 'moderation' and not a.continued;
        continue when used >= ent.activations_per_period;
      end if;
    end if;
    insert into private.post_activations (post_id, entitlement_id, owner_id) values (post.id, ent.id, actor)
      returning * into current_activation;
    perform internal.price_draft_actor(); -- final live owner/session check after all waits
  return jsonb_build_object('activation_id', current_activation.id, 'entitlement_id', ent.id, 'reused', false);
  end loop;
  if any_usable then
    raise exception 'all posting capacity is in use' using errcode = 'PT409';
  end if;
  raise exception 'no active plan covers this post' using errcode = 'PT402';
end;
$function$;
alter function internal.activate_post(uuid) owner to postgres;
revoke all on function internal.activate_post(uuid) from public;
grant execute on function internal.activate_post(uuid) to authenticated;
