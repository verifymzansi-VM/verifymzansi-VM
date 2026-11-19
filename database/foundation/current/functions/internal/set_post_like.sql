-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.set_post_like(p_post_id uuid, p_device uuid, p_account uuid, p_liked boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  liker uuid := p_account; post_owner uuid; device bytea; is_liked boolean; wanted boolean;
  totals private.post_engagement_totals; this_hour timestamptz := date_trunc('hour', statement_timestamp());
begin
  if p_post_id is null or p_device is null then
    raise exception 'like details are invalid' using errcode='22023', detail='like_invalid';
  end if;
  -- An account that is not active counts as signed out.
  if liker is not null and not exists(select 1 from private.current_account_access a where a.id=liker) then
    liker := null;
  end if;
  select p.owner_id into post_owner from private.posts p
    join private.post_search_documents d on d.post_id = p.id
    where p.id = p_post_id and d.is_visible and (d.visible_until is null or d.visible_until > statement_timestamp())
      and exists(select 1 from private.public_eligible_posts e where e.id = p.id);
  if not found then
    raise exception 'post unavailable' using errcode='PT404', detail='post_unavailable';
  end if;
  select sha256(k.like_key || convert_to('device|' || p_device::text, 'UTF8')) into device
    from private.engagement_keys k where k.id = 1;
  -- One change at a time per post: its totals row is the lock.
  insert into private.post_engagement_totals(post_id) values (p_post_id) on conflict (post_id) do nothing;
  select t.* into totals from private.post_engagement_totals t where t.post_id = p_post_id for update;
  if liker is not null and (liker = post_owner
      or exists(select 1 from private.staff_roles r where r.user_id=liker and r.revoked_at is null)) then
    -- The owner's and staff's own likes are never stored; they may remove the
    -- like their browser made while signed out.
    if p_liked is not true then
      delete from private.post_likes l where l.post_id = p_post_id and l.device_mark = device;
    end if;
    return jsonb_build_object('liked', false, 'counted', false, 'likes',
      (select t.likes from private.post_engagement_totals t where t.post_id = p_post_id));
  end if;
  -- Signed in: only the account's like; signed out: only this browser's.
  is_liked := case when liker is not null
    then exists(select 1 from private.post_likes l where l.post_id = p_post_id and l.account_id = liker)
    else exists(select 1 from private.post_likes l where l.post_id = p_post_id and l.device_mark = device) end;
  wanted := coalesce(p_liked, not is_liked);
  if wanted and not is_liked then
    if totals.like_hour_start = this_hour and totals.like_hour_count >= 600 then
      raise exception 'too many likes on this post; try again later' using errcode='PT429', detail='like_limit';
    end if;
    insert into private.post_likes(post_id, device_mark, account_id)
      values (p_post_id, case when liker is null then device end, liker);
    update private.post_engagement_totals t set like_hour_start = this_hour,
        like_hour_count = case when t.like_hour_start = this_hour then t.like_hour_count + 1 else 1 end
      where t.post_id = p_post_id;
  elsif is_liked and not wanted then
    if liker is not null then
      delete from private.post_likes l where l.post_id = p_post_id and l.account_id = liker;
    else
      delete from private.post_likes l where l.post_id = p_post_id and l.device_mark = device;
    end if;
  end if;
  return jsonb_build_object('liked', wanted, 'counted', true, 'likes',
    (select t.likes from private.post_engagement_totals t where t.post_id = p_post_id));
end;
$function$;
alter function internal.set_post_like(uuid,uuid,uuid,boolean) owner to postgres;
revoke all on function internal.set_post_like(uuid,uuid,uuid,boolean) from public;
grant execute on function internal.set_post_like(uuid,uuid,uuid,boolean) to service_role;
