-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.set_post_like(p_post_id uuid, p_device uuid, p_account uuid, p_liked boolean, p_device_issued_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  liker uuid := p_account; post_owner uuid; device bytea; mine private.post_likes; wanted boolean;
  today date := (statement_timestamp() at time zone 'Africa/Johannesburg')::date;
  starts timestamptz := statement_timestamp(); day_likes integer;
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
  perform 1 from private.post_engagement_totals t where t.post_id = p_post_id for update;
  -- Likes of this post that were waiting and are due now start to count.
  update private.post_likes l set waiting = false
    where l.post_id = p_post_id and l.waiting and l.counts_from <= statement_timestamp();
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
  if liker is not null then
    select l.* into mine from private.post_likes l where l.post_id = p_post_id and l.account_id = liker;
  else
    select l.* into mine from private.post_likes l where l.post_id = p_post_id and l.device_mark = device;
  end if;
  wanted := coalesce(p_liked, mine.id is null);
  if wanted and mine.id is null then
    -- Storage safety valve for the whole site.
    insert into private.post_view_salts(day, salt)
      values (today, decode(replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-',''),'hex'))
      on conflict (day) do nothing;
    select s.likes into day_likes from private.post_view_salts s where s.day = today;
    -- Storage safety valve: over 50,000 net new likes in a day only
    -- established likers' likes are stored (not an error: that would undo
    -- the alarm).
    if day_likes >= 50000 and not internal.engagement_established(liker, p_device_issued_at) then
      return jsonb_build_object('liked', false, 'counted', false, 'likes',
        (select t.likes from private.post_engagement_totals t where t.post_id = p_post_id));
    end if;
    -- A browser identifier issued in the last 10 minutes: its like waits.
    if liker is null and p_device_issued_at is not null then
      starts := greatest(starts, p_device_issued_at + interval '10 minutes');
    end if;
    insert into private.post_likes(post_id, device_mark, account_id, counts_from, waiting)
      values (p_post_id, case when liker is null then device end, liker, starts, starts > statement_timestamp());
    update private.post_view_salts s set likes = s.likes + 1 where s.day = today
      returning s.likes into day_likes;
    perform internal.engagement_valve_alarms('post_likes_new', 50000, day_likes - 1, day_likes);
  elsif mine.id is not null and not wanted then
    delete from private.post_likes l where l.id = mine.id;
    -- The day's count is net: a like made today and taken back gives its place back.
    if (mine.created_at at time zone 'Africa/Johannesburg')::date = today then
      update private.post_view_salts s set likes = greatest(s.likes - 1, 0) where s.day = today;
    end if;
  end if;
  return jsonb_build_object('liked', wanted, 'counted', true, 'likes',
    (select t.likes from private.post_engagement_totals t where t.post_id = p_post_id)
      + case when wanted and exists(select 1 from private.post_likes l where l.post_id = p_post_id and l.waiting
          and (l.account_id = liker or (liker is null and l.device_mark = device))) then 1 else 0 end);
end;
$function$;
alter function internal.set_post_like(uuid,uuid,uuid,boolean,timestamp with time zone) owner to postgres;
revoke all on function internal.set_post_like(uuid,uuid,uuid,boolean,timestamp with time zone) from public;
grant execute on function internal.set_post_like(uuid,uuid,uuid,boolean,timestamp with time zone) to service_role;
