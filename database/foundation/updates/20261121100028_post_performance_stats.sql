-- Post performance statistics for the owner's Performance page (launch
-- checklist item 2, the part after 20261119172135_post_views_and_likes.sql).
--
-- The restored Performance page (/dashboard/metrics) shows, for the owner's
-- own posts: views with engaged views, leads, the last 30 days of appearances
-- in lists, search, the home page, the showrooms and organisation pages,
-- detail views and where they came from, contact taps, shares, saves and
-- unique viewers, and each live post's showroom turns over the last 7 days
-- next to the fair share. The website already sends these events to
-- /api/analytics/events; this update stores them as daily counters per post
-- and gives the owner one read.
--
-- Counting rules (as for views and likes): no sign-in needed; never the
-- signed-in owner's own events and never any event by an account with an
-- active staff role (an inactive account counts as signed out); only posts
-- that are publicly live. The website limits requests per source (IPv4
-- address or IPv6 /48) and filters crawlers and prefetches. Nothing about
-- the visitor is stored: no account, browser identifier, network address or
-- user agent; only how many times each thing happened to a post on a day.
--
-- 1. New table private.post_activity_days: one row per post per day
--    (Africa/Johannesburg) with 21 counters: list_impressions,
--    search_appearances, homepage_appearances, showroom_home,
--    showroom_business, showroom_market, showroom_tourism,
--    showroom_programme, directory_appearances, views_direct,
--    views_internal, views_search, views_social, views_referral (detail views
--    by where the visitor came from), whatsapp_taps, phone_taps,
--    website_taps, directions_taps, booking_taps, ticket_taps and shares.
--    Its size depends on the number of posts with activity, not on the
--    number of visitors. Deleted with the post; rows older than 31 days are
--    deleted by the engagement clean-up job (below). Row level security on;
--    no API role has table access.
-- 2. New column private.post_engagement_totals.engaged_views (all time): a
--    view that became engaged (30 seconds of the post's video, or 90% of a
--    shorter one). It counts at most once per browser per post in 24 hours,
--    only for a browser whose view of that post was counted in the last 24
--    hours, with a second mark in private.post_view_marks
--    (sha256(day salt || 'engaged:' || browser || post)), so engaged views
--    never exceed views.
-- 3. api.record_post_activity(p_post_ids uuid[], p_metrics text[], p_device
--    uuid, p_account uuid) (service only): 1 to 50 (post, counter) pairs
--    (22023 activity_invalid otherwise; a counter is one of the 21 columns
--    or engaged_views, which needs p_device). Each distinct (post, counter)
--    pair counts at most once per call. Pairs of posts that do not count are
--    skipped. Returns {"posts": n, "engaged": n}: the posts whose
--    counters moved and the engaged views counted.
-- 4. api.get_my_post_performance() (authenticated; the caller's own posts
--    only, with a live session): returns
--    {"posts", "live_posts", "views", "engaged_views", "leads",
--     "last_30_days": {impression, detail_view, whatsapp_click, phone_click,
--       website_click, directions_click, booking_click, ticket_click,
--       showroom_appearance, organisation_directory_appearance,
--       search_appearance, homepage_appearance, share, save,
--       unique_viewers},
--     "top_posts": at most 10 {post_id, title, area, appearances, views,
--       unique_viewers, contacts, saves, shares},
--     "sources": [{source, views}],
--     "showroom_turns": [{post_id, title, surface, appearances, fair_share,
--       eligible_posts}]}.
--    Views and engaged views are all time; leads are the enquiries received
--    (kept 12 months); unique viewers are the counted views of the last 30
--    days (one per browser per post per day, so a visitor who comes back on
--    another day counts again); saves are the likes made in the last 30 days
--    that still count; the fair share of a showroom is its appearances in
--    the last 7 days divided by the posts now eligible for it (home: every
--    publicly live post; business, market, tourism: those of that area).
-- 5. The clean-up of old view and engagement records becomes its own job:
--    api.purge_post_engagement() (service only), run every minute by the
--    website's minute job, recorded as scheduled job engagement_purge (late
--    after 10 minutes). internal.purge_post_engagement also deletes activity
--    rows older than 31 days; internal.run_retention no longer calls it.
--
-- Replaced functions (full bodies; each checked against its reviewed body):
-- internal.run_retention, internal.purge_post_engagement and
-- internal.scheduled_job_catalogue.
--
-- New commands and one new catalogue job only. The live website's staff
-- operations page lists the catalogue strictly but stays switched off until
-- launch (SHOW_STAFF_OPERATIONS). Between applying and deploying, old view
-- marks wait for the new website's minute job (they stop counting after 24
-- hours anyway). ORDER: apply first, then merge.
-- Read-only preflight: ../preflight/20261121100028_post_performance_stats.check.sql.
-- Rollback: ../rollback/20261121100028_post_performance_stats.down.sql.
begin;
-- Never wait more than 5 seconds for anything this update needs.
set local lock_timeout='5s';

-- Precondition: nothing of this update exists yet, or all of it does, and the
-- three functions it replaces have their reviewed bodies (or this update's).
do $$
declare present integer; shape text;
begin
  select (to_regclass('private.post_activity_days') is not null)::integer
    + (exists(select 1 from pg_attribute a where a.attrelid = 'private.post_engagement_totals'::regclass
        and a.attname = 'engaged_views' and not a.attisdropped))::integer
    + (to_regprocedure('internal.record_post_activity(uuid[],text[],uuid,uuid)') is not null)::integer
    + (to_regprocedure('api.record_post_activity(uuid[],text[],uuid,uuid)') is not null)::integer
    + (to_regprocedure('internal.get_my_post_performance()') is not null)::integer
    + (to_regprocedure('api.get_my_post_performance()') is not null)::integer
    + (to_regprocedure('api.purge_post_engagement()') is not null)::integer
  into present;
  if present not in (0, 7) then
    raise exception 'post performance stats precondition: % of 7 objects exist', present
      using errcode='55000';
  end if;
  for shape in
    select v.sig||' '||coalesce((select md5(replace(p.prosrc,E'\r\n',E'\n')) from pg_proc p
        where p.oid=to_regprocedure(v.sig)),'absent')
    from (values ('internal.run_retention(integer)'), ('internal.purge_post_engagement()'),
      ('internal.scheduled_job_catalogue()')) v(sig)
  loop
    if shape not in (
        'internal.run_retention(integer) 1d51acbc8fb435ac6f9b1f12a9020c2b',
        'internal.run_retention(integer) 135e5c77e403b724fdcd48844a994938',
        'internal.purge_post_engagement() fbb695dd3bc67f5ae8a5d759f5fed652',
        'internal.purge_post_engagement() bf66fca749e26139b57022aaaeb3d7bd',
        'internal.scheduled_job_catalogue() 249bf575fc434934aafe0f0a68ea30dc',
        'internal.scheduled_job_catalogue() 64487ac2aa106de196e413992e126488') then
      raise exception 'post performance stats precondition: % is not a reviewed body', shape
        using errcode='55000';
    end if;
  end loop;
end$$;

create table if not exists private.post_activity_days (
  post_id uuid not null,
  day date not null,
  list_impressions integer not null default 0,
  search_appearances integer not null default 0,
  homepage_appearances integer not null default 0,
  showroom_home integer not null default 0,
  showroom_business integer not null default 0,
  showroom_market integer not null default 0,
  showroom_tourism integer not null default 0,
  showroom_programme integer not null default 0,
  directory_appearances integer not null default 0,
  views_direct integer not null default 0,
  views_internal integer not null default 0,
  views_search integer not null default 0,
  views_social integer not null default 0,
  views_referral integer not null default 0,
  whatsapp_taps integer not null default 0,
  phone_taps integer not null default 0,
  website_taps integer not null default 0,
  directions_taps integer not null default 0,
  booking_taps integer not null default 0,
  ticket_taps integer not null default 0,
  shares integer not null default 0,
  constraint post_activity_days_pkey primary key (post_id, day),
  constraint post_activity_days_post_id_fkey foreign key (post_id) references private.posts(id) on delete cascade,
  constraint post_activity_days_counts_check check (least(list_impressions, search_appearances,
    homepage_appearances, showroom_home, showroom_business, showroom_market, showroom_tourism,
    showroom_programme, directory_appearances, views_direct, views_internal, views_search, views_social,
    views_referral, whatsapp_taps, phone_taps, website_taps, directions_taps, booking_taps, ticket_taps,
    shares) >= 0)
);
alter table private.post_activity_days owner to postgres;
alter table private.post_activity_days enable row level security;
revoke all on private.post_activity_days from public, anon, authenticated, service_role;
-- The clean-up and the showroom fair share read by day.
create index if not exists post_activity_days_day_idx on private.post_activity_days using btree (day);

alter table private.post_engagement_totals add column if not exists engaged_views bigint not null default 0;
alter table private.post_engagement_totals drop constraint if exists post_engagement_totals_engaged_views_check;
alter table private.post_engagement_totals add constraint post_engagement_totals_engaged_views_check
  check (engaged_views >= 0);

-- Lock order (no deadlock): the posts' activity rows in id order, then their
-- totals rows in id order. Nothing else locks activity rows.
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
  return jsonb_build_object('posts', moved, 'engaged', engaged);
end;
$function$;
alter function internal.record_post_activity(uuid[],text[],uuid,uuid) owner to postgres;
revoke all on function internal.record_post_activity(uuid[],text[],uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function internal.record_post_activity(uuid[],text[],uuid,uuid) to service_role;

CREATE OR REPLACE FUNCTION api.record_post_activity(p_post_ids uuid[], p_metrics text[], p_device uuid DEFAULT NULL::uuid, p_account uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.record_post_activity(p_post_ids, p_metrics, p_device, p_account);
$function$;
alter function api.record_post_activity(uuid[],text[],uuid,uuid) owner to postgres;
revoke all on function api.record_post_activity(uuid[],text[],uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function api.record_post_activity(uuid[],text[],uuid,uuid) to service_role;

-- The owner's Performance page: the caller's own posts only (edit copies are
-- not posts of their own), with a live session (internal.price_draft_actor,
-- which is volatile, so this read is too; it changes nothing).
CREATE OR REPLACE FUNCTION internal.get_my_post_performance()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  actor uuid := internal.price_draft_actor();
  today date := (statement_timestamp() at time zone 'Africa/Johannesburg')::date;
  since timestamptz := ((statement_timestamp() at time zone 'Africa/Johannesburg')::date - 29)::timestamp
    at time zone 'Africa/Johannesburg';
  result jsonb;
begin
  with mine as (
    select p.id, p.title, p.area,
      exists(select 1 from private.post_search_documents d where d.post_id = p.id and d.is_visible
        and (d.visible_until is null or d.visible_until > statement_timestamp())
        and exists(select 1 from private.public_eligible_posts x where x.id = p.id)) as live
    from private.posts p where p.owner_id = actor and p.edit_of is null
  ), stats as (
    select m.id, m.title, m.area, m.live,
      coalesce(t.views, 0) as views_total, coalesce(t.engaged_views, 0) as engaged_total,
      coalesce(a.list_impressions, 0) as list_impressions, coalesce(a.search_appearances, 0) as search_appearances,
      coalesce(a.homepage_appearances, 0) as homepage_appearances, coalesce(a.showroom, 0) as showroom,
      coalesce(a.directory_appearances, 0) as directory_appearances,
      coalesce(a.views_direct, 0) as views_direct, coalesce(a.views_internal, 0) as views_internal,
      coalesce(a.views_search, 0) as views_search, coalesce(a.views_social, 0) as views_social,
      coalesce(a.views_referral, 0) as views_referral,
      coalesce(a.whatsapp_taps, 0) as whatsapp_taps, coalesce(a.phone_taps, 0) as phone_taps,
      coalesce(a.website_taps, 0) as website_taps, coalesce(a.directions_taps, 0) as directions_taps,
      coalesce(a.booking_taps, 0) as booking_taps, coalesce(a.ticket_taps, 0) as ticket_taps,
      coalesce(a.shares, 0) as shares, coalesce(u.viewers, 0) as unique_viewers, coalesce(l.saves, 0) as saves
    from mine m
    left join private.post_engagement_totals t on t.post_id = m.id
    left join lateral (select sum(x.list_impressions) as list_impressions, sum(x.search_appearances) as search_appearances,
        sum(x.homepage_appearances) as homepage_appearances,
        sum(x.showroom_home + x.showroom_business + x.showroom_market + x.showroom_tourism + x.showroom_programme) as showroom,
        sum(x.directory_appearances) as directory_appearances, sum(x.views_direct) as views_direct,
        sum(x.views_internal) as views_internal, sum(x.views_search) as views_search, sum(x.views_social) as views_social,
        sum(x.views_referral) as views_referral, sum(x.whatsapp_taps) as whatsapp_taps, sum(x.phone_taps) as phone_taps,
        sum(x.website_taps) as website_taps, sum(x.directions_taps) as directions_taps,
        sum(x.booking_taps) as booking_taps, sum(x.ticket_taps) as ticket_taps, sum(x.shares) as shares
      from private.post_activity_days x where x.post_id = m.id and x.day >= today - 29) a on true
    left join lateral (select sum(x.views) as viewers from private.post_view_days x
      where x.post_id = m.id and x.day >= today - 29) u on true
    left join lateral (select count(*) as saves from private.post_likes x
      where x.post_id = m.id and not x.waiting and x.counts_from >= since) l on true
  ), per_post as (
    select s.*,
      s.list_impressions + s.search_appearances + s.homepage_appearances + s.showroom + s.directory_appearances as appearances,
      s.views_direct + s.views_internal + s.views_search + s.views_social + s.views_referral as detail_views,
      s.whatsapp_taps + s.phone_taps + s.website_taps + s.directions_taps + s.booking_taps + s.ticket_taps as contacts
    from stats s
  ), surface_totals as (
    select v.surface, v.appearances from (
      select coalesce(sum(x.showroom_home), 0) as home, coalesce(sum(x.showroom_business), 0) as business,
        coalesce(sum(x.showroom_market), 0) as market, coalesce(sum(x.showroom_tourism), 0) as tourism
      from private.post_activity_days x where x.day >= today - 6) s
    cross join lateral (values ('home', s.home), ('business', s.business), ('market', s.market),
      ('tourism', s.tourism)) v(surface, appearances)
  ), eligible as (
    select v.surface, v.posts from (
      select count(*) as home, count(*) filter (where p.area = 'business') as business,
        count(*) filter (where p.area = 'market') as market,
        count(*) filter (where p.area = 'tourism_events') as tourism
      from private.post_search_documents d join private.posts p on p.id = d.post_id
      where d.is_visible and (d.visible_until is null or d.visible_until > statement_timestamp())
        and exists(select 1 from private.public_eligible_posts x where x.id = p.id)) s
    cross join lateral (values ('home', s.home), ('business', s.business), ('market', s.market),
      ('tourism', s.tourism)) v(surface, posts)
  ), turns as (
    select m.id, m.title, v.surface, coalesce(sum(case v.surface when 'home' then x.showroom_home
        when 'business' then x.showroom_business when 'market' then x.showroom_market
        else x.showroom_tourism end), 0) as appearances
    from mine m
    cross join lateral (values ('home'), (case m.area when 'tourism_events' then 'tourism' else m.area end)) v(surface)
    left join private.post_activity_days x on x.post_id = m.id and x.day >= today - 6
    where m.live
    group by m.id, m.title, v.surface
  )
  select jsonb_build_object(
    'posts', (select count(*) from per_post),
    'live_posts', (select count(*) from per_post where live),
    'views', (select coalesce(sum(views_total), 0) from per_post),
    'engaged_views', (select coalesce(sum(engaged_total), 0) from per_post),
    'leads', (select count(*) from private.enquiries e where e.owner_id = actor),
    'last_30_days', (select jsonb_build_object(
        'impression', coalesce(sum(list_impressions), 0),
        'detail_view', coalesce(sum(detail_views), 0),
        'whatsapp_click', coalesce(sum(whatsapp_taps), 0),
        'phone_click', coalesce(sum(phone_taps), 0),
        'website_click', coalesce(sum(website_taps), 0),
        'directions_click', coalesce(sum(directions_taps), 0),
        'booking_click', coalesce(sum(booking_taps), 0),
        'ticket_click', coalesce(sum(ticket_taps), 0),
        'showroom_appearance', coalesce(sum(showroom), 0),
        'organisation_directory_appearance', coalesce(sum(directory_appearances), 0),
        'search_appearance', coalesce(sum(search_appearances), 0),
        'homepage_appearance', coalesce(sum(homepage_appearances), 0),
        'share', coalesce(sum(shares), 0),
        'save', coalesce(sum(saves), 0),
        'unique_viewers', coalesce(sum(unique_viewers), 0)) from per_post),
    'top_posts', coalesce((select jsonb_agg(jsonb_build_object('post_id', t.id, 'title', t.title, 'area', t.area,
        'appearances', t.appearances, 'views', t.detail_views, 'unique_viewers', t.unique_viewers,
        'contacts', t.contacts, 'saves', t.saves, 'shares', t.shares)
        order by t.detail_views + t.contacts desc, t.appearances desc, t.id)
      from (select * from per_post
        where appearances + detail_views + unique_viewers + contacts + saves + shares > 0
        order by detail_views + contacts desc, appearances desc, id limit 10) t), '[]'::jsonb),
    'sources', coalesce((select jsonb_agg(jsonb_build_object('source', v.source, 'views', v.views)
        order by v.views desc, v.source)
      from (select sum(views_direct) as direct, sum(views_internal) as internal, sum(views_search) as search,
          sum(views_social) as social, sum(views_referral) as referral from per_post) s
      cross join lateral (values ('direct', s.direct), ('internal', s.internal), ('search', s.search),
        ('social', s.social), ('referral', s.referral)) v(source, views)
      where v.views > 0), '[]'::jsonb),
    'showroom_turns', coalesce((select jsonb_agg(jsonb_build_object('post_id', t.id, 'title', t.title,
        'surface', t.surface, 'appearances', t.appearances,
        'fair_share', coalesce(round(st.appearances::numeric / nullif(e.posts, 0), 1), 0),
        'eligible_posts', e.posts)
        order by t.title, t.surface, t.id)
      from turns t join surface_totals st on st.surface = t.surface join eligible e on e.surface = t.surface),
      '[]'::jsonb))
  into result;
  return result;
end;
$function$;
alter function internal.get_my_post_performance() owner to postgres;
revoke all on function internal.get_my_post_performance() from public, anon, authenticated, service_role;
grant execute on function internal.get_my_post_performance() to authenticated;

CREATE OR REPLACE FUNCTION api.get_my_post_performance()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.get_my_post_performance();
$function$;
alter function api.get_my_post_performance() owner to postgres;
revoke all on function api.get_my_post_performance() from public, anon, authenticated, service_role;
grant execute on function api.get_my_post_performance() to authenticated;

-- The engagement clean-up job (every minute, from the website's minute job):
-- view and engaged marks older than 24 hours (the dedupe window) and salts
-- older than yesterday, in batches of 10,000 marks (at most 200,000 a run;
-- the rest the next run), waiting likes that are due (at most 1,000 posts a
-- run), and activity rows older than 31 days.
CREATE OR REPLACE FUNCTION internal.purge_post_engagement()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  today date := (statement_timestamp() at time zone 'Africa/Johannesburg')::date;
  salts integer; marks integer := 0; batch integer; rounds integer := 0; released integer; activity integer;
begin
  delete from private.post_view_salts s where s.day < today - 1;
  get diagnostics salts = row_count;
  loop
    delete from private.post_view_marks m where m.mark in (select x.mark from private.post_view_marks x
      where x.seen_at < statement_timestamp() - interval '24 hours' limit 10000);
    get diagnostics batch = row_count;
    marks := marks + batch;
    rounds := rounds + 1;
    exit when batch < 10000 or rounds >= 20;
  end loop;
  -- Posts in id order, each locked through its totals row, as the like command does.
  with due as (
    select l.post_id from private.post_likes l where l.waiting and l.counts_from <= statement_timestamp()
    group by l.post_id order by l.post_id limit 1000
  ), locked as (
    select t.post_id from private.post_engagement_totals t join due on due.post_id = t.post_id
    order by t.post_id for update of t
  )
  update private.post_likes l set waiting = false from locked
    where l.post_id = locked.post_id and l.waiting and l.counts_from <= statement_timestamp();
  get diagnostics released = row_count;
  delete from private.post_activity_days a where a.day < today - 30;
  get diagnostics activity = row_count;
  return jsonb_build_object('salts', salts, 'marks', marks, 'likes_released', released, 'activity_days', activity);
end;
$function$;
alter function internal.purge_post_engagement() owner to postgres;
revoke all on function internal.purge_post_engagement() from public, anon, authenticated, service_role;
grant execute on function internal.purge_post_engagement() to service_role;

CREATE OR REPLACE FUNCTION api.purge_post_engagement()
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.note_scheduled_job_run('engagement_purge', internal.purge_post_engagement());
$function$;
alter function api.purge_post_engagement() owner to postgres;
revoke all on function api.purge_post_engagement() from public, anon, authenticated, service_role;
grant execute on function api.purge_post_engagement() to service_role;

-- The scheduled jobs: engagement_purge added (every minute).
CREATE OR REPLACE FUNCTION internal.scheduled_job_catalogue()
 RETURNS TABLE(job text, every text, late_after interval, ord integer)
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
  -- The timed Workers' schedules: wrangler.ops-jobs.toml (every minute),
  -- wrangler.retention-cleanup.toml (every 5 minutes) and
  -- wrangler.payment-cleanup.toml (every 10 minutes; the refund check daily).
  select v.job, v.every, v.late_after, v.ord from (values
    (1, 'slot_renewals', 'minute', interval '10 minutes'),
    (2, 'post_lifecycle', 'minute', interval '10 minutes'),
    (3, 'sponsorships', 'minute', interval '10 minutes'),
    (4, 'inbox_purge', 'minute', interval '10 minutes'),
    (5, 'intro_trials', 'minute', interval '10 minutes'),
    (6, 'commissions', 'minute', interval '10 minutes'),
    (7, 'bank_transfer_expiry', 'minute', interval '10 minutes'),
    (8, 'package_add_invoices', 'minute', interval '10 minutes'),
    (9, 'email_delivery', 'minute', interval '10 minutes'),
    (10, 'payment_alerts', 'minute', interval '10 minutes'),
    (11, 'privacy_notices', 'minute', interval '10 minutes'),
    (12, 'retention', '5_minutes', interval '30 minutes'),
    (13, 'form_drafts', '5_minutes', interval '30 minutes'),
    (14, 'evidence_cleanup', '5_minutes', interval '30 minutes'),
    (15, 'media_cleanup', '5_minutes', interval '30 minutes'),
    (16, 'payment_checks', '10_minutes', interval '40 minutes'),
    (17, 'refund_check', 'day', interval '26 hours'),
    (18, 'engagement_purge', 'minute', interval '10 minutes')
  ) v(ord, job, every, late_after)
$function$;
alter function internal.scheduled_job_catalogue() owner to postgres;
revoke all on function internal.scheduled_job_catalogue() from public,anon,authenticated,service_role;

-- The retention job: the engagement clean-up is now its own job (above).
CREATE OR REPLACE FUNCTION internal.run_retention(p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare result jsonb;
begin
  if p_limit is null or p_limit not between 1 and 5000 then
    raise exception 'limit 1 to 5000' using errcode='22023'; end if;
  perform pg_catalog.set_config('vm.retention','on',true);
  perform internal.purge_frontend_post_commands(p_limit);perform internal.purge_frontend_post_actions(p_limit); result:=jsonb_build_object(
    'accounts',internal.run_account_erasures(least(p_limit,20)),
    'privacy_requests',internal.retention_privacy_requests(p_limit),
    'inbox',internal.purge_expired_inbox(p_limit),
    'identity_bans',internal.purge_expired_identity_bans(p_limit),
    'trial_identities',internal.purge_expired_trial_identities(p_limit),
    'verification',internal.retention_verification(p_limit),
    'staff_records',internal.retention_staff_records(p_limit),
    'commerce',internal.retention_commerce(p_limit),
    'operations',internal.retention_operations(p_limit),
    'member_invitations',internal.purge_member_invitations(p_limit),
    'capture_handoffs',internal.purge_capture_handoffs(p_limit));
  perform pg_catalog.set_config('vm.retention','off',true);
  return result;
end;
$function$;
alter function internal.run_retention(integer) owner to postgres;
revoke all on function internal.run_retention(integer) from public;
grant execute on function internal.run_retention(integer) to service_role;

notify pgrst,'reload schema';
commit;
