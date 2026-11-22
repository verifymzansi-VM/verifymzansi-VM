-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.showroom_feed(p_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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
revoke all on function internal.showroom_feed(jsonb) from public;
grant execute on function internal.showroom_feed(jsonb) to anon;
grant execute on function internal.showroom_feed(jsonb) to authenticated;
