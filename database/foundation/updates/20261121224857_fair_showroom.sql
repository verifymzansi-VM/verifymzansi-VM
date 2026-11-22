-- Fair showroom for every post (launch checklist item 66, design approved by
-- the owner on 21 November 2026: "Approve all 7").
--
-- The home showroom and each area showroom (business, market, tourism) show
-- every publicly live post in turn, mixed by the visitor's area:
--
-- 1. Turns. A post's turn score is how far it is behind its fair share of the
--    showroom's appearances over the last 7 days (the counters of
--    20261121100028_post_performance_stats.sql). The fair share is the one the
--    owner's Performance page shows: the showroom's appearances in the last 7
--    days divided by the posts now in it (at least 1). Score =
--    (fair share - own appearances) / fair share, so one whole turn is one fair
--    share. Posts furthest behind go first.
-- 2. New posts. For 72 hours after a post first went live it is "new": the
--    card carries is_new, and it gets one extra turn that fades evenly to
--    nothing over the 72 hours. A post that went live before (an earlier
--    approval of the post itself in private.moderation_log) is not new again
--    when it is approved again; an unchanged reactivation keeps its first
--    published_at anyway.
-- 3. Nudges, all together under one turn, so none jumps a post a whole turn
--    behind: 0.15 of a turn for a ready video; likes per view over the last
--    30 days, smoothed as if every post started with 1 like in 20 views, at
--    0.75 of a turn per like-rate up to 0.15 (reached at 1 like in 5 views);
--    and up to 0.3 of a turn of randomness so two visitors never get
--    identical showrooms and nobody can predict the order. The video and
--    likes nudges grow with the showroom's appearances: nothing while the
--    showroom has had none in the last 7 days (then every post is level and
--    the randomness shares the places), in full once its posts average one
--    appearance each.
-- 4. Area. The request may name the visitor's province, and with it the
--    visitor's city (the website reads them from the request; nothing about the
--    visitor is stored). Of every 7 places, 1, 4 and 6 go to posts in the
--    visitor's city, 2 and 5 to the rest of the province, 3 and 7 to the rest
--    of South Africa. A group that runs out passes its places to the next
--    (city, then province, then the rest, then the city again), so the
--    showroom is never short while posts are live. A post shown more than twice
--    the fair share this week loses its city and province places and waits in
--    the rest-of-South-Africa queue. Without a province every place comes from
--    the one all-South-Africa queue.
--
-- From this update:
-- - internal.showroom_feed(request) (security definer) and the public read
--   api.showroom_feed(request) (visitors and members, security invoker).
--   Request: {"showroom": home | business | market | tourism (home when
--   omitted), "province"?: province id, "city"?: city id of that province}.
--   Answer: {"items": [card]}, at most 15 cards for home and 7 for an area, in
--   showroom order. A card has the public search card fields (id, kind, area,
--   category, activity, title, summary, price_mode, price_cents,
--   price_negotiable, province, city, locality, condition, published_at), its
--   preview (image_key, video_key) and is_new. No score, counts, owner or
--   account. The read is volatile (random order) and writes nothing.
-- - Index private.moderation_log_post_approvals_idx: a post's own approvals,
--   for the "went live before" lookup.
--
-- Expand only: one new API command and one index; nothing is replaced,
-- removed or stored.
-- ORDER: apply first, then merge (the website's deploy check probes every
-- command in the runtime manifest; the showroom falls back to the newest posts
-- if the read fails).
-- Read-only preflight: ../preflight/20261121224857_fair_showroom.check.sql.
-- Rollback: ../rollback/20261121224857_fair_showroom.down.sql.
begin;
-- Never wait more than 5 seconds for anything this update needs.
set local lock_timeout='5s';

-- Precondition: the two functions and the index are all absent or all
-- present, and the activity counters it reads exist.
do $$
declare present integer;
begin
  select (to_regprocedure('internal.showroom_feed(jsonb)') is not null)::integer
    + (to_regprocedure('api.showroom_feed(jsonb)') is not null)::integer
    + (to_regclass('private.moderation_log_post_approvals_idx') is not null)::integer
  into present;
  if present not in (0, 3) then
    raise exception 'fair showroom precondition: % of 3 parts exist', present using errcode='55000';
  end if;
  if to_regclass('private.post_activity_days') is null then
    raise exception 'fair showroom precondition: private.post_activity_days is missing' using errcode='55000';
  end if;
end$$;

-- The "went live before" lookup: a post's own approvals (not its edits').
create index if not exists moderation_log_post_approvals_idx on private.moderation_log
  using btree (post_id) where edit_id is null and decision = 'approve';

create or replace function internal.showroom_feed(p_request jsonb)
returns jsonb
language plpgsql
volatile security definer
set search_path to 'pg_catalog'
as $function$
declare
  req jsonb := coalesce(p_request, '{}'::jsonb);
  v_showroom text;
  v_area text;
  v_province text;
  v_city text;
  v_places integer;
  today date := (statement_timestamp() at time zone 'Africa/Johannesburg')::date;
  -- Of every 7 places: 1, 4 and 6 the visitor's city (group 1), 2 and 5 the
  -- rest of the province (group 2), 3 and 7 the rest of South Africa (group 3).
  pattern constant integer[] := array[1, 2, 3, 1, 2, 1, 3];
  q_city uuid[];
  q_province uuid[];
  q_rest uuid[];
  q_new uuid[];
  taken integer[] := array[0, 0, 0];
  chosen uuid[] := '{}'::uuid[];
  g integer;
  h integer;
  picked uuid;
  result jsonb;
begin
  if jsonb_typeof(req) <> 'object' or octet_length(req::text) > 1024 then
    raise exception 'invalid showroom request' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_each(req) e
      where e.key not in ('showroom', 'province', 'city') or jsonb_typeof(e.value) <> 'string') then
    raise exception 'unknown showroom filter' using errcode = '22023';
  end if;
  v_showroom := coalesce(req->>'showroom', 'home');
  if v_showroom not in ('home', 'business', 'market', 'tourism') then
    raise exception 'unknown showroom' using errcode = '22023';
  end if;
  v_area := case v_showroom when 'business' then 'business' when 'market' then 'market'
    when 'tourism' then 'tourism_events' end;
  v_places := case when v_showroom = 'home' then 15 else 7 end;
  v_province := req->>'province';
  if v_province is not null and not exists (select 1 from private.provinces p where p.id = v_province) then
    raise exception 'unknown province' using errcode = '22023';
  end if;
  v_city := req->>'city';
  if v_city is not null and (v_province is null or not exists (select 1 from private.cities c
      where c.id = v_city and c.province_id = v_province)) then
    raise exception 'city requires its province' using errcode = '22023';
  end if;

  with candidates as materialized (
    -- The showroom's posts: publicly live as in public search.
    select d.post_id, d.province_id, d.city_id, d.published_at
    from private.post_search_documents d
    where d.is_visible and d.published_at <= statement_timestamp()
      and (d.visible_until is null or d.visible_until > statement_timestamp())
      and (v_area is null or d.area = v_area)
      and exists (select 1 from private.public_eligible_posts e where e.id = d.post_id)
  ), shown as (
    select a.post_id, sum(case v_showroom when 'home' then a.showroom_home
        when 'business' then a.showroom_business when 'market' then a.showroom_market
        else a.showroom_tourism end) as n
    from private.post_activity_days a
    where a.day >= today - 6
    group by a.post_id
  ), average as (
    select coalesce((select sum(s.n) from shown s), 0)::numeric
      / nullif((select count(*) from candidates), 0) as n
  ), fair as (
    -- The fair share (at least 1), and how much of the video and likes
    -- nudges applies: none without appearances, all from 1 per post.
    select greatest(a.n, 1) as share, least(coalesce(a.n, 0), 1) as nudge
    from average a
  ), approved_before as (
    -- Recent posts that an earlier approval already put live once.
    select distinct m.post_id
    from private.moderation_log m
    join candidates c on c.post_id = m.post_id
    where c.published_at > statement_timestamp() - interval '72 hours'
      and m.edit_id is null and m.decision = 'approve' and m.decided_at < c.published_at
  ), likes as (
    select l.post_id, count(*) as n
    from private.post_likes l
    join candidates c on c.post_id = l.post_id
    where not l.waiting and l.counts_from >= statement_timestamp() - interval '30 days'
    group by l.post_id
  ), views as (
    select v.post_id, sum(v.views) as n
    from private.post_view_days v
    join candidates c on c.post_id = v.post_id
    where v.day >= today - 29
    group by v.post_id
  ), scored as (
    select c.post_id, x.is_new,
      case when v_province is null or coalesce(s.n, 0) > 2 * f.share then 3
        when v_city is not null and c.city_id = v_city then 1
        when c.province_id = v_province then 2
        else 3 end as grp,
      (f.share - coalesce(s.n, 0)) / f.share
        + case when x.is_new
            then 1 - extract(epoch from statement_timestamp() - c.published_at) / 259200 else 0 end
        + f.nudge * (case when exists (select 1 from private.post_media pm
            join private.media_objects m on m.id = pm.object_id
            where pm.post_id = c.post_id and m.state = 'ready' and m.kind = 'video') then 0.15 else 0 end
          + least(0.15, 0.75 * (coalesce(lk.n, 0) + 1)::numeric / (coalesce(vw.n, 0) + 20)))
        + (random() * 0.3)::numeric as score
    from candidates c
    cross join fair f
    left join shown s on s.post_id = c.post_id
    left join likes lk on lk.post_id = c.post_id
    left join views vw on vw.post_id = c.post_id
    cross join lateral (select c.published_at > statement_timestamp() - interval '72 hours'
      and not exists (select 1 from approved_before b where b.post_id = c.post_id) as is_new) x
  ), ranked as (
    select r.*, row_number() over (partition by r.grp order by r.score desc, r.post_id) as rn
    from scored r
  )
  select
    coalesce(array_agg(r.post_id order by r.rn) filter (where r.grp = 1), '{}'),
    coalesce(array_agg(r.post_id order by r.rn) filter (where r.grp = 2), '{}'),
    coalesce(array_agg(r.post_id order by r.rn) filter (where r.grp = 3), '{}'),
    coalesce(array_agg(r.post_id) filter (where r.is_new), '{}')
  into q_city, q_province, q_rest, q_new
  from ranked r
  where r.rn <= v_places;

  for k in 1..v_places loop
    g := pattern[(k - 1) % 7 + 1];
    picked := null;
    -- The place's own group, else the next one along.
    for t in 0..2 loop
      h := (g - 1 + t) % 3 + 1;
      if taken[h] < cardinality(case h when 1 then q_city when 2 then q_province else q_rest end) then
        taken[h] := taken[h] + 1;
        picked := (case h when 1 then q_city when 2 then q_province else q_rest end)[taken[h]];
        exit;
      end if;
    end loop;
    exit when picked is null;
    chosen := chosen || picked;
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object('id', d.post_id, 'kind', d.kind, 'area', d.area,
      'category', d.category_key, 'activity', d.activity_key, 'title', d.title, 'summary', d.summary,
      'price_mode', d.price_mode, 'price_cents', d.price_cents::text, 'price_negotiable', d.price_negotiable,
      'province', d.province_id, 'condition', case when d.kind = 'listing' then d.facets->>'condition' end,
      'city', d.city_id, 'locality', d.locality_label, 'published_at', d.published_at,
      'is_new', d.post_id = any (q_new),
      'preview', jsonb_build_object(
        'image_key', (select m.object_key from private.post_media pm
          join private.media_objects m on m.id = pm.object_id
          where pm.post_id = d.post_id and m.state = 'ready' and m.kind = 'image'
          order by (pm.purpose = 'cover') desc, pm.position limit 1),
        'video_key', (select m.object_key from private.post_media pm
          join private.media_objects m on m.id = pm.object_id
          where pm.post_id = d.post_id and m.state = 'ready' and m.kind = 'video'
          order by pm.position limit 1)))
    order by x.place), '[]'::jsonb)
  into result
  from unnest(chosen) with ordinality x(post_id, place)
  join private.post_search_documents d on d.post_id = x.post_id;

  return jsonb_build_object('items', result);
end;
$function$;
alter function internal.showroom_feed(jsonb) owner to postgres;

create or replace function api.showroom_feed(p_request jsonb)
returns jsonb
language sql
volatile security invoker
set search_path to 'pg_catalog'
as $$
  select internal.showroom_feed(p_request);
$$;
alter function api.showroom_feed(jsonb) owner to postgres;
revoke all on function internal.showroom_feed(jsonb), api.showroom_feed(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function internal.showroom_feed(jsonb), api.showroom_feed(jsonb)
  to anon, authenticated;

commit;
