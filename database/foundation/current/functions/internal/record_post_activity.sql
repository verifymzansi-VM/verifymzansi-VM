-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.record_post_activity(p_post_ids uuid[], p_metrics text[], p_device uuid, p_account uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  today date := (statement_timestamp() at time zone 'Africa/Johannesburg')::date;
  viewer uuid := p_account; moved integer := 0; engaged integer := 0;
  salt_today bytea; salt_before bytea; pid uuid; seen bytea; again bytea;
  showroom_marks bytea[] := '{}'::bytea[]; day_marks integer; after_marks integer;
begin
  if p_post_ids is null or p_metrics is null or cardinality(p_post_ids) not between 1 and 50
    or cardinality(p_metrics) <> cardinality(p_post_ids)
    or array_position(p_post_ids, null) is not null or array_position(p_metrics, null) is not null
    or not p_metrics <@ array['list_impressions', 'search_appearances', 'homepage_appearances',
      'showroom_home', 'showroom_business', 'showroom_market', 'showroom_tourism', 'showroom_programme',
      'directory_appearances', 'views_direct', 'views_internal', 'views_search', 'views_social',
      'views_referral', 'whatsapp_taps', 'phone_taps', 'website_taps', 'directions_taps', 'booking_taps',
      'ticket_taps', 'shares', 'engaged_views']
    or (p_device is null and 'engaged_views' = any(p_metrics)) then
    raise exception 'activity details are invalid' using errcode='22023', detail='activity_invalid';
  end if;
  -- An account that is not active counts as signed out.
  if viewer is not null and not exists(select 1 from private.current_account_access a where a.id=viewer) then
    viewer := null;
  end if;
  -- Staff activity is never counted.
  if viewer is not null and exists(select 1 from private.staff_roles r where r.user_id=viewer and r.revoked_at is null) then
    return jsonb_build_object('posts', 0, 'engaged', 0);
  end if;

  -- Showroom appearances count at most once per browser, post and showroom a
  -- day: a mark under the day's salt, as views use (deleted after 24 hours
  -- by the engagement clean-up), only for posts that would count (publicly
  -- live, not the viewer's own; an area showroom's counter only for a post of
  -- that area). Without a browser they do not count. The marks add to the
  -- views' daily count, but stop at 200,000 of it, so showroom traffic alone
  -- never closes the views' 300,000 storage valve.
  if p_device is not null and exists(select 1 from unnest(p_metrics) m where m like 'showroom\_%') then
    insert into private.post_view_salts(day, salt)
      values (today, decode(replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-',''),'hex'))
      on conflict (day) do nothing;
    select s.salt, s.views into salt_today, day_marks from private.post_view_salts s where s.day = today;
    if day_marks < 200000 then
      with fresh as (
        insert into private.post_view_marks(mark)
        select sha256(salt_today || convert_to('showroom:' || e.metric || ':' || p_device::text || '|' || e.post_id::text, 'UTF8'))
        from (select distinct x.post_id, x.metric from unnest(p_post_ids, p_metrics) x(post_id, metric)
          where x.metric like 'showroom\_%') e
        join private.posts p on p.id = e.post_id
        join private.post_search_documents d on d.post_id = p.id
        where d.is_visible and (d.visible_until is null or d.visible_until > statement_timestamp())
          and exists(select 1 from private.public_eligible_posts l where l.id = p.id)
          and p.owner_id is distinct from viewer
          and (e.metric not in ('showroom_business', 'showroom_market', 'showroom_tourism')
            or d.area = case e.metric when 'showroom_business' then 'business'
              when 'showroom_market' then 'market' else 'tourism_events' end)
        order by 1
        on conflict (mark) do nothing
        returning mark)
      select coalesce(array_agg(f.mark), '{}'::bytea[]) into showroom_marks from fresh f;
    end if;
  end if;

  -- The day's counters of each publicly live post the viewer does not own;
  -- each distinct (post, counter) pair adds at most 1 per call.
  insert into private.post_activity_days as a (post_id, day, list_impressions, search_appearances,
      homepage_appearances, showroom_home, showroom_business, showroom_market, showroom_tourism,
      showroom_programme, directory_appearances, views_direct, views_internal, views_search, views_social,
      views_referral, whatsapp_taps, phone_taps, website_taps, directions_taps, booking_taps, ticket_taps, shares)
  select e.post_id, today,
    count(*) filter (where e.metric = 'list_impressions'),
    count(*) filter (where e.metric = 'search_appearances'),
    count(*) filter (where e.metric = 'homepage_appearances'),
    count(*) filter (where e.metric = 'showroom_home'),
    count(*) filter (where e.metric = 'showroom_business'),
    count(*) filter (where e.metric = 'showroom_market'),
    count(*) filter (where e.metric = 'showroom_tourism'),
    count(*) filter (where e.metric = 'showroom_programme'),
    count(*) filter (where e.metric = 'directory_appearances'),
    count(*) filter (where e.metric = 'views_direct'),
    count(*) filter (where e.metric = 'views_internal'),
    count(*) filter (where e.metric = 'views_search'),
    count(*) filter (where e.metric = 'views_social'),
    count(*) filter (where e.metric = 'views_referral'),
    count(*) filter (where e.metric = 'whatsapp_taps'),
    count(*) filter (where e.metric = 'phone_taps'),
    count(*) filter (where e.metric = 'website_taps'),
    count(*) filter (where e.metric = 'directions_taps'),
    count(*) filter (where e.metric = 'booking_taps'),
    count(*) filter (where e.metric = 'ticket_taps'),
    count(*) filter (where e.metric = 'shares')
  from (select distinct x.post_id, x.metric from unnest(p_post_ids, p_metrics) x(post_id, metric)) e
  join private.posts p on p.id = e.post_id
  join private.post_search_documents d on d.post_id = p.id
  where e.metric <> 'engaged_views' and d.is_visible
    and (e.metric not like 'showroom\_%' or sha256(salt_today || convert_to('showroom:' || e.metric || ':'
      || p_device::text || '|' || e.post_id::text, 'UTF8')) = any (showroom_marks))
    and (d.visible_until is null or d.visible_until > statement_timestamp())
    and exists(select 1 from private.public_eligible_posts x where x.id = p.id)
    and p.owner_id is distinct from viewer
  group by e.post_id
  order by e.post_id
  on conflict (post_id, day) do update set
    list_impressions = a.list_impressions + excluded.list_impressions,
    search_appearances = a.search_appearances + excluded.search_appearances,
    homepage_appearances = a.homepage_appearances + excluded.homepage_appearances,
    showroom_home = a.showroom_home + excluded.showroom_home,
    showroom_business = a.showroom_business + excluded.showroom_business,
    showroom_market = a.showroom_market + excluded.showroom_market,
    showroom_tourism = a.showroom_tourism + excluded.showroom_tourism,
    showroom_programme = a.showroom_programme + excluded.showroom_programme,
    directory_appearances = a.directory_appearances + excluded.directory_appearances,
    views_direct = a.views_direct + excluded.views_direct,
    views_internal = a.views_internal + excluded.views_internal,
    views_search = a.views_search + excluded.views_search,
    views_social = a.views_social + excluded.views_social,
    views_referral = a.views_referral + excluded.views_referral,
    whatsapp_taps = a.whatsapp_taps + excluded.whatsapp_taps,
    phone_taps = a.phone_taps + excluded.phone_taps,
    website_taps = a.website_taps + excluded.website_taps,
    directions_taps = a.directions_taps + excluded.directions_taps,
    booking_taps = a.booking_taps + excluded.booking_taps,
    ticket_taps = a.ticket_taps + excluded.ticket_taps,
    shares = a.shares + excluded.shares;
  get diagnostics moved = row_count;

  -- Engaged views: once per browser per post in 24 hours, only after that
  -- browser's view of the post was counted in the last 24 hours (its view
  -- mark, under today's or yesterday's salt).
  if 'engaged_views' = any(p_metrics) then
    select s.salt into salt_today from private.post_view_salts s where s.day = today;
    select s.salt into salt_before from private.post_view_salts s where s.day = today - 1;
    for pid in select distinct e.post_id from unnest(p_post_ids, p_metrics) e(post_id, metric)
        where e.metric = 'engaged_views' order by 1 loop
      exit when salt_today is null and salt_before is null;
      continue when not exists(select 1 from private.posts p
        join private.post_search_documents d on d.post_id = p.id
        where p.id = pid and d.is_visible and (d.visible_until is null or d.visible_until > statement_timestamp())
          and exists(select 1 from private.public_eligible_posts x where x.id = p.id)
          and p.owner_id is distinct from viewer);
      continue when not exists(select 1 from private.post_view_marks m
        where m.seen_at > statement_timestamp() - interval '24 hours'
          and m.mark in (sha256(coalesce(salt_today, salt_before) || convert_to('device:' || p_device::text || '|' || pid::text, 'UTF8')),
            sha256(coalesce(salt_before, salt_today) || convert_to('device:' || p_device::text || '|' || pid::text, 'UTF8'))));
      seen := sha256(coalesce(salt_today, salt_before) || convert_to('engaged:' || p_device::text || '|' || pid::text, 'UTF8'));
      again := sha256(coalesce(salt_before, salt_today) || convert_to('engaged:' || p_device::text || '|' || pid::text, 'UTF8'));
      continue when exists(select 1 from private.post_view_marks m
        where m.seen_at > statement_timestamp() - interval '24 hours' and m.mark in (seen, again));
      insert into private.post_view_marks(mark) values (seen) on conflict (mark) do nothing;
      -- An engaged view sent twice at once counts once.
      continue when not found;
      insert into private.post_engagement_totals as t (post_id, engaged_views) values (pid, 1)
        on conflict (post_id) do update set engaged_views = t.engaged_views + 1;
      engaged := engaged + 1;
    end loop;
  end if;
  -- The day's count of showroom marks, once per request and last (as views).
  if cardinality(showroom_marks) > 0 then
    update private.post_view_salts s set views = s.views + cardinality(showroom_marks) where s.day = today
      returning s.views into after_marks;
    perform internal.engagement_valve_alarms('post_views_counted', 300000,
      after_marks - cardinality(showroom_marks), after_marks);
  end if;
  return jsonb_build_object('posts', moved, 'engaged', engaged);
end;
$function$;
alter function internal.record_post_activity(uuid[],text[],uuid,uuid) owner to postgres;
revoke all on function internal.record_post_activity(uuid[],text[],uuid,uuid) from public;
grant execute on function internal.record_post_activity(uuid[],text[],uuid,uuid) to service_role;
