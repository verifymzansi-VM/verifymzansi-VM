-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.set_post_like(p_post_id uuid, p_device uuid, p_account uuid, p_liked boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare liker uuid := p_account; post_owner uuid; device bytea; is_liked boolean; wanted boolean; total bigint;
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
  -- One change at a time per browser, then per account, on this post.
  perform pg_advisory_xact_lock(hashtextextended('post_like:' || p_post_id::text || ':' || encode(device, 'hex'), 0));
  if liker is not null then
    perform pg_advisory_xact_lock(hashtextextended('post_like:' || p_post_id::text || ':' || liker::text, 0));
  end if;
  is_liked := exists(select 1 from private.post_likes l where l.post_id = p_post_id
    and (l.device_mark = device or (liker is not null and l.account_id = liker)));
  wanted := coalesce(p_liked, not is_liked);
  if liker is not null and liker = post_owner then
    -- The owner's own like is never stored.
    select count(*) into total from private.post_likes l where l.post_id = p_post_id;
    return jsonb_build_object('liked', is_liked, 'likes', total, 'counted', false);
  end if;
  if wanted and not is_liked then
    if (select count(*) from private.post_likes l where l.post_id = p_post_id
        and l.created_at > statement_timestamp() - interval '1 hour') >= 600 then
      raise exception 'too many likes on this post; try again later' using errcode='PT429', detail='like_limit';
    end if;
    insert into private.post_likes(post_id, device_mark, account_id) values (p_post_id, device, liker)
      on conflict do nothing;
  elsif is_liked and not wanted then
    delete from private.post_likes l where l.post_id = p_post_id
      and (l.device_mark = device or (liker is not null and l.account_id = liker));
  end if;
  select count(*) into total from private.post_likes l where l.post_id = p_post_id;
  return jsonb_build_object('liked', wanted, 'likes', total, 'counted', true);
end;
$function$;
alter function internal.set_post_like(uuid,uuid,uuid,boolean) owner to postgres;
revoke all on function internal.set_post_like(uuid,uuid,uuid,boolean) from public;
grant execute on function internal.set_post_like(uuid,uuid,uuid,boolean) to service_role;
