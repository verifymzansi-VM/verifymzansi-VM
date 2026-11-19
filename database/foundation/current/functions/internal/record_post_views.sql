-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.record_post_views(p_post_ids uuid[], p_device uuid, p_account uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  today date := (statement_timestamp() at time zone 'Africa/Johannesburg')::date;
  viewer uuid := p_account; salt_today bytea; salt_before bytea; pid uuid; post_owner uuid;
  new_mark bytea; counted uuid[] := '{}'::uuid[]; day_views integer;
begin
  if p_post_ids is null or p_device is null or cardinality(p_post_ids) not between 1 and 5
    or array_position(p_post_ids, null) is not null then
    raise exception 'view details are invalid' using errcode='22023', detail='views_invalid';
  end if;
  -- An account that is not active counts as signed out.
  if viewer is not null and not exists(select 1 from private.current_account_access a where a.id=viewer) then
    viewer := null;
  end if;
  -- Staff views are never counted.
  if viewer is not null and exists(select 1 from private.staff_roles r where r.user_id=viewer and r.revoked_at is null) then
    return jsonb_build_object('counted', '[]'::jsonb);
  end if;
  -- The day's salt. The retention job deletes old salts and marks; this only
  -- keeps at most two salts if that job has not run.
  insert into private.post_view_salts(day, salt)
    values (today, decode(replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-',''),'hex'))
    on conflict (day) do nothing;
  if found then
    delete from private.post_view_salts s where s.day < today - 1;
  end if;
  select s.salt, s.views into salt_today, day_views from private.post_view_salts s where s.day = today;
  select s.salt into salt_before from private.post_view_salts s where s.day = today - 1;
  -- Storage safety valve for the whole site (requests racing may pass it by a
  -- few views).
  if day_views >= 300000 then
    insert into private.cost_alarms (metric, level, period, used, free_quantity)
      values ('post_views_counted', 'critical', to_char(today, 'YYYY-MM-DD'), day_views, 300000)
      on conflict (metric, level, period) do nothing;
    return jsonb_build_object('counted', '[]'::jsonb);
  end if;
  for pid in select distinct x from unnest(p_post_ids) x order by 1 loop
    select p.owner_id into post_owner from private.posts p
      join private.post_search_documents d on d.post_id = p.id
      where p.id = pid and d.is_visible and (d.visible_until is null or d.visible_until > statement_timestamp())
        and exists(select 1 from private.public_eligible_posts e where e.id = p.id);
    continue when not found or post_owner = viewer;
    -- Seen by this browser in the last 24 hours, under today's or yesterday's salt.
    continue when exists(select 1 from private.post_view_marks m
      where m.seen_at > statement_timestamp() - interval '24 hours'
        and m.mark in (sha256(salt_today || convert_to('device:' || p_device::text || '|' || pid::text, 'UTF8')),
          sha256(coalesce(salt_before, salt_today) || convert_to('device:' || p_device::text || '|' || pid::text, 'UTF8'))));
    new_mark := sha256(salt_today || convert_to('device:' || p_device::text || '|' || pid::text, 'UTF8'));
    insert into private.post_view_marks(mark) values (new_mark) on conflict (mark) do nothing;
    -- A view sent twice at once counts once.
    continue when not found;
    insert into private.post_view_days as d (post_id, day, views) values (pid, today, 1)
      on conflict (post_id, day) do update set views = d.views + 1;
    insert into private.post_engagement_totals as t (post_id, views) values (pid, 1)
      on conflict (post_id) do update set views = t.views + 1;
    -- Likes of this post that were waiting and are due now start to count.
    update private.post_likes l set waiting = false
      where l.post_id = pid and l.waiting and l.counts_from <= statement_timestamp();
    counted := counted || pid;
  end loop;
  -- The day's count, once per request and last.
  if cardinality(counted) > 0 then
    update private.post_view_salts s set views = s.views + cardinality(counted) where s.day = today;
  end if;
  return jsonb_build_object('counted', to_jsonb(counted));
end;
$function$;
alter function internal.record_post_views(uuid[],uuid,uuid) owner to postgres;
revoke all on function internal.record_post_views(uuid[],uuid,uuid) from public;
grant execute on function internal.record_post_views(uuid[],uuid,uuid) to service_role;
