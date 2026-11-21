-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

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
revoke all on function internal.get_my_post_performance() from public;
grant execute on function internal.get_my_post_performance() to authenticated;
