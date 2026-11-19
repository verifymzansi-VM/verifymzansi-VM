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
  this_hour timestamptz := date_trunc('hour', statement_timestamp());
  viewer uuid := p_account; salt_today bytea; salt_before bytea; pid uuid; post_owner uuid;
  new_mark bytea; counted uuid[] := '{}'::uuid[];
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
  select s.salt into salt_today from private.post_view_salts s where s.day = today;
  -- The day's limit for the whole site (a few views over it at most, when
  -- requests race).
  if (select s.views from private.post_view_salts s where s.day = today) >= 300000 then
    return jsonb_build_object('counted', '[]'::jsonb);
  end if;
  select s.salt into salt_before from private.post_view_salts s where s.day = today - 1;
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
    insert into private.post_view_days as d (post_id, day, views, hour_start, hour_views)
      values (pid, today, 1, this_hour, 1)
      on conflict (post_id, day) do update set views = d.views + 1, hour_start = excluded.hour_start,
        hour_views = case when d.hour_start = excluded.hour_start then d.hour_views + 1 else 1 end
      where d.views < 20000 and (d.hour_start <> excluded.hour_start or d.hour_views < 3000);
    if not found then
      -- Over the post's hourly or daily cap: not counted, and not remembered.
      delete from private.post_view_marks m where m.mark = new_mark;
      continue;
    end if;
    insert into private.post_engagement_totals as t (post_id, views) values (pid, 1)
      on conflict (post_id) do update set views = t.views + 1;
    update private.post_view_salts s set views = s.views + 1 where s.day = today;
    counted := counted || pid;
  end loop;
  return jsonb_build_object('counted', to_jsonb(counted));
end;
$function$;
alter function internal.record_post_views(uuid[],uuid,uuid) owner to postgres;
revoke all on function internal.record_post_views(uuid[],uuid,uuid) from public;
grant execute on function internal.record_post_views(uuid[],uuid,uuid) to service_role;
