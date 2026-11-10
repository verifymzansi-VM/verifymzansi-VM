-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.start_intro_trial(p_post_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare post private.posts; fingerprint text; granted jsonb; ent uuid; fallback uuid; candidate private.entitlements;
  photos integer; videos integer;
begin
  select * into post from private.posts p where p.id=p_post_id;
  if not found or post.kind='event' or post.edit_of is not null
    or not exists(select 1 from private.intro_trial_requests r where r.post_id=post.id and r.owner_id=post.owner_id) then
    raise exception 'post does not wait for the free week' using errcode='22023';
  end if;
  fingerprint:=internal.current_verified_identity(post.owner_id);
  if fingerprint is null then
    raise exception 'complete identity verification before posting' using errcode='42501',detail='posting_verification_required';
  end if;
  select count(distinct pm.object_id) filter(where pm.purpose<>'video'),count(distinct pm.object_id) filter(where pm.purpose='video')
    into photos,videos from private.post_media pm where pm.post_id=post.id;
  for candidate in
    select e.* from private.entitlements e
    where internal.entitlement_usable(e.status,e.starts_at,e.ends_at)
      and (e.area is null or e.area=post.area)
      and (e.owner_id=post.owner_id or exists(select 1 from private.entitlement_members m
        where m.entitlement_id=e.id and m.member_id=post.owner_id))
    order by e.ends_at,e.id
    for update
  loop
    continue when not internal.entitlement_for_post_eligible(candidate.id,post.id,post.owner_id)
      or photos>candidate.max_photos or videos>candidate.max_videos
      or (select count(*) from private.post_activations a where a.entitlement_id=candidate.id and a.released_at is null)
        >=candidate.slot_capacity
      or (candidate.activations_per_period is not null and (select count(*) from private.post_activations a
        where a.entitlement_id=candidate.id and a.activated_at>statement_timestamp()-make_interval(days=>candidate.activation_period_days))
        >=candidate.activations_per_period);
    fallback:=coalesce(fallback,candidate.id);
    if candidate.ends_at>=statement_timestamp()+interval '7 days' then
      ent:=candidate.id;
      exit;
    end if;
  end loop;
  if ent is null then
    if not exists(select 1 from private.trial_identities t where t.owner_id=post.owner_id and t.identity_hmac<>fingerprint) then
      granted:=internal.grant_intro_trial(post.owner_id,fingerprint,7);
    end if;
    ent:=coalesce((granted->>'entitlement_id')::uuid,fallback);
    if ent is null then
      raise exception 'no plan or free week covers this post' using errcode='PT402';
    end if;
  end if;
  update private.post_activations set released_at=statement_timestamp(),release_reason='entitlement_ended'
    where post_id=post.id and released_at is null;
  insert into private.post_activations(post_id,entitlement_id,owner_id) values(post.id,ent,post.owner_id);
  delete from private.intro_trial_requests r where r.post_id=post.id;
  return ent;
end;
$function$;
alter function internal.start_intro_trial(uuid) owner to postgres;
revoke all on function internal.start_intro_trial(uuid) from public;
