-- Catalogue filters run in the database (launch checklist item 29).
--
-- Three public lists did their filtering, merging or paging in the website,
-- after reading far more cards than they showed:
-- - an organisation's supported businesses (/organisation/<slug> and
--   /mzansi-business?org=) read the whole Business area 48 cards at a time
--   and kept the organisation's posts in the website, so they missed any
--   business past position 4,800;
-- - a text search under Businesses without a category read the Business
--   area and the tourism businesses separately and merged them in the
--   website, up to 480 results;
-- - Video mode read four pages of 50 full cards per section to use their ids.
-- internal.search_posts (full body; behind api.search_posts and
-- internal.search_post_cards) gains five optional request keys, so each list
-- is one filtered, ordered, counted and paged call:
-- - organisation (a slug): only posts with an active affiliation to that
--   listed organisation (internal.organisation_listed). An unknown or unlisted
--   slug matches nothing, as the website's filter did.
-- - programme (a uuid; needs organisation): only that affiliation programme.
-- - sponsored (true or false; needs organisation): when true, only posts with
--   an active sponsorship by that organisation running now, the rule of
--   internal.public_post_sponsorships.
-- - kind (listing, business or event): without an area, kind business is the
--   Business area plus the tourism businesses (tourism_hospitality is the only
--   business category outside the Business area).
-- - ids_only (true or false): when true, items is a list of post ids in the
--   same order, and the page may hold 1 to 200 (otherwise 1 to 48).
-- Filters, order, totals, offsets (at most 4,800), cursors and replies to
-- requests without the new keys are unchanged.
-- internal.search_post_cards (full body) refuses ids_only (22023), so a card
-- page stays at most 48 cards.
--
-- No API command, argument, table or index is added or removed. The
-- organisation filter probes organisation_affiliations_active_idx
-- (organisation_id, post_id) and the sponsorship filter
-- organisation_sponsorships_post_idx (post_id).
-- ORDER: apply first, then merge. The website release from the same pull
-- request sends the new keys, which the earlier body refuses as unknown; the
-- earlier website never sends them and gets the same replies as before.
-- It refuses with 55000 unless both functions have their reviewed bodies (or
-- this update's).
-- Read-only preflight: ../preflight/20261126062428_catalogue_filters_in_database.check.sql.
-- Rollback: ../rollback/20261126062428_catalogue_filters_in_database.down.sql.
begin;
-- Never wait more than 5 seconds for anything this update needs.
set local lock_timeout='5s';

do $$
declare shape text;
begin
  for shape in
    select v.sig||' '||coalesce((select md5(replace(p.prosrc,E'\r\n',E'\n')) from pg_proc p where p.oid=to_regprocedure(v.sig)),'absent')
    from (values ('internal.search_posts(jsonb)'),('internal.search_post_cards(jsonb)')) v(sig)
  loop
    if shape not in (
        'internal.search_posts(jsonb) 590ffdf23439ddbf6772f70afd199740',
        'internal.search_posts(jsonb) 3084bc16bb1a0fe19ed94f19a3e23089',
        'internal.search_post_cards(jsonb) 6bb60ea1828671af6f73e785d217c8ba',
        'internal.search_post_cards(jsonb) 4d8eb454d3e5650e8bf9f553ae0c0b50') then
      raise exception 'catalogue filters precondition: % is not a reviewed body', shape
        using errcode='55000';
    end if;
  end loop;
end$$;

CREATE OR REPLACE FUNCTION internal.search_posts(p_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  req jsonb := coalesce(p_request, '{}');
  allowed text[] := array['q', 'sort', 'area', 'category', 'activity', 'province', 'city', 'price_mode',
    'min_price_cents', 'max_price_cents', 'condition', 'attributes', 'cursor', 'limit', 'offset', 'post_id', 'business_type', 'event_state', 'event_order', 'storefront', 'make',
    'organisation', 'programme', 'sponsored', 'kind', 'ids_only'];
  v_ids boolean := false;
  v_kind text;
  v_org_filter boolean := false;
  v_org uuid;
  v_programme uuid;
  v_sponsored boolean := false;
  v_sort text;
  v_offset integer := 0;
  v_post_id uuid;
  v_store uuid;
  v_store_package uuid;
  v_make text;
  v_business_type text;
  v_event_state text;
  v_event_order text;
  v_asof timestamptz := statement_timestamp();
  v_after_score numeric;
  v_limit integer := 24;
  v_q text;
  v_terms text[];
  v_tsquery tsquery;
  v_area text;
  v_category text;
  v_activity text;
  v_province text;
  v_city text;
  v_price_mode text;
  v_condition text;
  v_min bigint;
  v_max bigint;
  v_attrs jsonb := '{}';
  v_contains jsonb := '{}';
  v_ranges jsonb := '[]';
  v_signature text;
  v_cursor jsonb;
  v_after_at timestamptz;
  v_after_id uuid;
  f record;
  attr record;
  v_items jsonb;
  v_total bigint;
  v_facets jsonb;
  v_has_more boolean;
begin
  if jsonb_typeof(req) <> 'object' or octet_length(req::text) > 4096 then
    raise exception 'invalid search request' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_object_keys(req) k where k <> all (allowed)) then
    raise exception 'unknown search filter' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_each(req) e where e.key not in ('attributes', 'limit', 'offset', 'min_price_cents', 'max_price_cents', 'sponsored', 'ids_only')
      and jsonb_typeof(e.value) <> 'string') then
    raise exception 'search filters must be strings' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_each(req) e where e.key in ('sponsored', 'ids_only')
      and jsonb_typeof(e.value) <> 'boolean') then
    raise exception 'sponsored and ids_only must be true or false' using errcode = '22023';
  end if;
  v_ids := coalesce((req->>'ids_only')::boolean, false);

  if req ? 'limit' then
    if jsonb_typeof(req->'limit') <> 'number' or (req->>'limit') !~ '^[0-9]{1,3}$'
      or (req->>'limit')::integer not between 1 and (case when v_ids then 200 else 48 end) then
      raise exception 'limit must be 1 to 48, or 1 to 200 with ids_only' using errcode = '22023';
    end if;
    v_limit := (req->>'limit')::integer;
  end if;

  if req ? 'offset' then
    if jsonb_typeof(req->'offset') <> 'number' or (req->>'offset') !~ '^[0-9]{1,6}$'
      or (req->>'offset')::integer > 4800 or req ? 'cursor' then
      raise exception 'invalid page offset' using errcode='22023';
    end if;
    v_offset := (req->>'offset')::integer;
  end if;
  if req ? 'post_id' then
    if req->>'post_id' !~* '^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$' then
      raise exception 'invalid post id' using errcode='22023';
    end if;
    v_post_id := (req->>'post_id')::uuid;
  end if;
  -- A business's storefront: the live Market listings of the package it
  -- represents (internal.storefront_package). A business without one has none.
  if req ? 'storefront' then
    if req->>'storefront' !~* '^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$' then
      raise exception 'invalid storefront' using errcode='22023';
    end if;
    v_store := (req->>'storefront')::uuid;
    v_store_package := internal.storefront_package(v_store);
  end if;
  -- A vehicle make, matched exactly (any case); only inside a storefront.
  v_make := req->>'make';
  if v_make is not null and (v_store is null or length(v_make) not between 1 and 80) then
    raise exception 'make filter requires a storefront' using errcode='22023';
  end if;
  v_kind := req->>'kind';
  if v_kind is not null and v_kind not in ('listing','business','event') then
    raise exception 'unknown post kind' using errcode='22023';
  end if;
  -- One listed organisation's supported posts (an unknown or unlisted slug
  -- matches nothing), optionally one of its programmes or its sponsored posts.
  if req ? 'organisation' then
    if req->>'organisation' !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or length(req->>'organisation') > 60 then
      raise exception 'invalid organisation' using errcode='22023';
    end if;
    v_org_filter := true;
    select o.id into v_org from private.organisations o
      where o.slug = req->>'organisation' and internal.organisation_listed(o);
  end if;
  if (req ? 'programme' or req ? 'sponsored') and not v_org_filter then
    raise exception 'programme and sponsored filters require an organisation' using errcode='22023';
  end if;
  if req ? 'programme' then
    if req->>'programme' !~* '^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$' then
      raise exception 'invalid programme' using errcode='22023';
    end if;
    v_programme := (req->>'programme')::uuid;
  end if;
  v_sponsored := coalesce((req->>'sponsored')::boolean, false);
  v_business_type := req->>'business_type';
  if v_business_type is not null and v_business_type not in
    ('mall_store','standalone_shop','home_business','mobile_service','online_only','market_stall') then
    raise exception 'invalid business type' using errcode='22023';
  end if;
  v_event_state := req->>'event_state';
  if v_event_state is not null and v_event_state not in ('active','upcoming','ongoing','ended','all') then
    raise exception 'invalid event state' using errcode='22023';
  end if;
  v_event_order := req->>'event_order';
  if v_event_order is not null and v_event_order not in ('start_asc','end_desc') then
    raise exception 'invalid event order' using errcode='22023';
  end if;
  if (v_event_order is not null or req->>'sort' in ('price_asc','price_desc')) and not(req ? 'offset') then
    raise exception 'this ordering requires page offsets' using errcode='22023';
  end if;

  if req ? 'q' then
    v_q := lower(normalize(req->>'q', NFKC));
    if length(v_q) > 200 then raise exception 'query too long' using errcode = '22023'; end if;
    select array_agg(m[1]) into v_terms from regexp_matches(v_q, '([[:alnum:]]+)', 'g') m;
    if coalesce(cardinality(v_terms), 0) > 8 or exists (select 1 from unnest(v_terms) t where length(t) > 40) then
      raise exception 'too many or too long search terms' using errcode = '22023';
    end if;
    if coalesce(cardinality(v_terms), 0) > 0 then
      -- Any-term query used only for ranking; matching requires every term.
      v_tsquery := to_tsquery('simple', array_to_string(array(select t || ':*' from unnest(v_terms) t), ' | '));
    else
      v_terms := null;
    end if;
  end if;
  v_sort := coalesce(req->>'sort', case when v_terms is null then 'newest' else 'relevance' end);
  if v_sort not in ('relevance', 'newest', 'price_asc', 'price_desc') or (v_sort = 'relevance' and v_terms is null) then
    raise exception 'sort must be relevance (with a query) or newest' using errcode = '22023';
  end if;

  v_area := req->>'area';
  if v_area is not null and v_area not in ('market', 'business', 'tourism_events') then
    raise exception 'unknown area' using errcode = '22023';
  end if;
  v_category := req->>'category';
  if v_category is not null and not exists (select 1 from private.categories c where c.key = v_category
      and (v_area is null or c.area = v_area)) then
    raise exception 'unknown category for this area' using errcode = '22023';
  end if;
  v_activity := req->>'activity';
  if v_activity is not null and (v_category is null or not exists (select 1 from private.category_activities a
      where a.category_key = v_category and a.key = v_activity)) then
    raise exception 'activity requires its category' using errcode = '22023';
  end if;
  v_province := req->>'province';
  if v_province is not null and not exists (select 1 from private.provinces p where p.id = v_province) then
    raise exception 'unknown province' using errcode = '22023';
  end if;
  v_city := req->>'city';
  if v_city is not null and (v_province is null or not exists (select 1 from private.cities c
      where c.id = v_city and c.province_id = v_province)) then
    raise exception 'city requires its province' using errcode = '22023';
  end if;
  v_price_mode := req->>'price_mode';
  v_condition := req->>'condition';
  if v_condition is not null and v_condition not in ('new','like_new','good','fair','for_parts') then
    raise exception 'unknown listing condition' using errcode='22023';
  end if;
  if v_price_mode is not null and v_price_mode not in ('amount', 'free', 'on_request') then
    raise exception 'unknown price mode' using errcode = '22023';
  end if;
  for f in select k, req->k as v from unnest(array['min_price_cents', 'max_price_cents']) k where req ? k loop
    if jsonb_typeof(f.v) <> 'number' or (f.v #>> '{}') !~ '^[0-9]{1,12}$' then
      raise exception 'price bounds must be whole cents' using errcode = '22023';
    end if;
  end loop;
  v_min := (req->>'min_price_cents')::bigint;
  v_max := (req->>'max_price_cents')::bigint;
  if (v_min is not null or v_max is not null) then
    if v_price_mode is distinct from 'amount' then
      raise exception 'price ranges apply to amount prices only' using errcode = '22023';
    end if;
    if v_min > v_max then raise exception 'minimum exceeds maximum' using errcode = '22023'; end if;
  end if;

  if req ? 'attributes' then
    v_attrs := req->'attributes';
    if jsonb_typeof(v_attrs) <> 'object' then raise exception 'attributes must be an object' using errcode = '22023'; end if;
    if v_attrs <> '{}' and v_category is null then
      raise exception 'attribute filters require a category' using errcode = '22023';
    end if;
    if v_condition is not null and v_attrs ? 'condition'
      and v_attrs->>'condition' is distinct from v_condition then
      raise exception 'conflicting condition filters' using errcode='22023';
    end if;
    for attr in select e.key, e.value from jsonb_each(v_attrs) e loop
      select cf.* into f from private.category_fields cf
        where cf.category_key = v_category and cf.key = attr.key and cf.facet_kind is not null;
      if not found then raise exception 'unknown attribute filter' using errcode = '22023'; end if;
      if f.facet_kind = 'boolean' then
        if jsonb_typeof(attr.value) <> 'boolean' then raise exception 'boolean filter expected' using errcode = '22023'; end if;
        v_contains := v_contains || jsonb_build_object(attr.key, attr.value);
      elsif f.facet_kind in ('choice', 'contains') then
        if jsonb_typeof(attr.value) <> 'string' or not coalesce(f.validation->'enum' ? (attr.value #>> '{}')
            or f.validation->'items'->'enum' ? (attr.value #>> '{}'), false) then
          raise exception 'unknown attribute choice' using errcode = '22023';
        end if;
        v_contains := v_contains || jsonb_build_object(attr.key,
          case when f.facet_kind = 'contains' then jsonb_build_array(attr.value) else attr.value end);
      else
        if jsonb_typeof(attr.value) <> 'object' or exists (select 1 from jsonb_object_keys(attr.value) k where k not in ('min', 'max'))
          or exists (select 1 from jsonb_each(attr.value) b where jsonb_typeof(b.value) <> 'number')
          or (attr.value->>'min')::numeric > (attr.value->>'max')::numeric then
          raise exception 'range filter expected' using errcode = '22023';
        end if;
        v_ranges := v_ranges || jsonb_build_array(jsonb_build_object('key', attr.key,
          'min', attr.value->'min', 'max', attr.value->'max'));
      end if;
    end loop;
  end if;

  -- The cursor is bound to every filter so a page can never continue a different query.
  v_signature := md5((req - 'cursor' - 'limit')::text);
  if req ? 'cursor' then
    begin
      v_cursor := convert_from(decode(translate(req->>'cursor', '-_', '+/'), 'base64'), 'UTF8')::jsonb;
      v_after_at := (v_cursor->>'at')::timestamptz;
      v_after_id := (v_cursor->>'id')::uuid;
      v_asof := (v_cursor->>'asof')::timestamptz;
      v_after_score := (v_cursor->>'score')::numeric;
    exception when others then
      raise exception 'invalid cursor' using errcode = '22023';
    end;
    if v_cursor->>'sig' is distinct from v_signature or v_cursor->>'sort' is distinct from v_sort
      or v_after_at is null or v_after_id is null or v_asof is null
      or (v_sort = 'relevance' and v_after_score is null) then
      raise exception 'cursor does not match this search' using errcode = '22023';
    end if;
  end if;

  with matches as (
    select d.*, e.starts_at as event_starts_at, e.ends_at as event_ends_at,
      case when v_sort = 'relevance' then round((
        0.75 * (ts_rank(d.document, v_tsquery, 32)
          + coalesce((select avg(extensions.word_similarity(t, d.search_text)) from unnest(v_terms) t), 0)) / 2
        + 0.25 / (1 + greatest(extract(epoch from (v_asof - d.published_at)), 0) / 2592000.0)
      )::numeric, 6) end as score
    from private.post_search_documents d
    left join private.business_details b on b.post_id=d.post_id
    left join private.event_details e on e.post_id=d.post_id
    where d.is_visible
      and exists(select 1 from private.public_eligible_posts eligible where eligible.id=d.post_id)
      and (v_post_id is null or d.post_id=v_post_id)
      and (v_store is null or (d.kind='listing' and exists(select 1 from private.post_activations a
        join private.entitlements c on c.id=a.entitlement_id
        where a.post_id=d.post_id and a.released_at is null and c.package_id=v_store_package)))
      and (v_make is null or exists(select 1 from private.listing_details ld
        where ld.post_id=d.post_id and lower(ld.attributes->>'make')=lower(v_make)))
      and (v_kind is null or d.kind=v_kind)
      and (not v_org_filter or exists(select 1 from private.organisation_affiliations af
        where af.organisation_id=v_org and af.post_id=d.post_id and af.status='active'
          and (v_programme is null or af.programme_id=v_programme)))
      and (not v_sponsored or exists(select 1 from private.organisation_sponsorships sp
        where sp.organisation_id=v_org and sp.post_id=d.post_id and sp.status='active'
          and sp.starts_at<=statement_timestamp() and sp.ends_at>statement_timestamp()))
      and (v_business_type is null or (d.kind='business' and b.business_type=v_business_type))
      and (v_event_state is null or (d.kind='event' and (
        v_event_state='all'
        or (v_event_state='active' and e.ends_at>=statement_timestamp())
        or (v_event_state='upcoming' and e.starts_at>statement_timestamp())
        or (v_event_state='ongoing' and e.starts_at<=statement_timestamp() and e.ends_at>=statement_timestamp())
        or (v_event_state='ended' and e.ends_at<statement_timestamp()))))
      and d.published_at <= v_asof
      and (d.visible_until is null or d.visible_until > statement_timestamp())
      and (v_terms is null or not exists (
        select 1 from unnest(v_terms) t
        where not (d.document @@ to_tsquery('simple', t || ':*')
          or (length(t) >= 4 and extensions.word_similarity(t, d.search_text) >= 0.5))))
      and (v_area is null or d.area = v_area)
      and (v_activity is null or d.activity_key = v_activity)
      and (v_province is null or d.province_id = v_province)
      and (v_city is null or d.city_id = v_city)
      and (v_price_mode is null or d.price_mode = v_price_mode)
      and (v_condition is null or (d.kind='listing' and d.facets->>'condition'=v_condition))
      and (v_min is null or d.price_cents >= v_min)
      and (v_max is null or d.price_cents <= v_max)
      and (v_contains = '{}' or d.facets @> v_contains)
      and not exists (
        select 1 from jsonb_array_elements(v_ranges) r
        where not (jsonb_typeof(d.facets->(r->>'key')) = 'number'
          and (r->'min' is null or (d.facets->>(r->>'key'))::numeric >= (r->>'min')::numeric)
          and (r->'max' is null or (d.facets->>(r->>'key'))::numeric <= (r->>'max')::numeric))
      )
  ),
  scoped as (
    select * from matches m where v_category is null or m.category_key = v_category
  ),
  page as (
    select * from scoped s
    where v_after_at is null
      or (v_sort = 'newest' and (s.published_at, s.post_id) < (v_after_at, v_after_id))
      or (v_sort = 'relevance' and (s.score, s.published_at, s.post_id) < (v_after_score, v_after_at, v_after_id))
    order by case when v_sort = 'relevance' then s.score end desc nulls last,
      case when v_event_order='start_asc' then s.event_starts_at end asc nulls last,
      case when v_event_order='end_desc' then s.event_ends_at end desc nulls last,
      case when v_sort='price_asc' then s.price_cents end asc nulls last,
      case when v_sort='price_desc' then s.price_cents end desc nulls last,
      s.published_at desc, s.post_id desc
    limit v_limit + 1 offset v_offset
  )
  select
    (select jsonb_object_agg(x.category_key, x.n)
      from (select m.category_key, count(*) n from matches m group by m.category_key) x),
    (select count(*) from scoped),
    (select coalesce(jsonb_agg(jsonb_build_object('id', p.post_id, 'kind', p.kind, 'area', p.area,
        'category', p.category_key, 'activity', p.activity_key, 'title', p.title, 'summary', p.summary,
        'price_mode', p.price_mode, 'price_cents', p.price_cents::text, 'price_negotiable', p.price_negotiable, 'province', p.province_id,
        'condition', case when p.kind='listing' then p.facets->>'condition' end,
        'city', p.city_id, 'locality', p.locality_label, 'published_at', p.published_at,
        'score', p.score::text)
        order by case when v_sort = 'relevance' then p.score end desc nulls last,
          case when v_event_order='start_asc' then p.event_starts_at end asc nulls last,
          case when v_event_order='end_desc' then p.event_ends_at end desc nulls last,
          case when v_sort='price_asc' then p.price_cents end asc nulls last,
          case when v_sort='price_desc' then p.price_cents end desc nulls last,
          p.published_at desc, p.post_id desc), '[]') from page p),
    (select count(*) > v_limit from page)
  into v_facets, v_total, v_items, v_has_more;
  if v_has_more then
    v_items := v_items - v_limit;
  end if;

  return jsonb_build_object(
    'items', case when v_ids then (select coalesce(jsonb_agg(x.item->'id' order by x.n), '[]')
      from jsonb_array_elements(v_items) with ordinality x(item, n)) else v_items end,
    'sort', v_sort,
    'total', v_total,
    'facets', jsonb_build_object('categories', coalesce(v_facets, '{}')),
    'next_cursor', case when v_has_more and not(req ? 'offset') then
      translate(encode(convert_to(jsonb_build_object('at', v_items->(v_limit - 1)->>'published_at',
        'id', v_items->(v_limit - 1)->>'id', 'score', v_items->(v_limit - 1)->>'score',
        'sort', v_sort, 'asof', v_asof, 'sig', v_signature)::text, 'UTF8'), 'base64'), E'+/\n', '-_')
      end
  );
end;
$function$;
alter function internal.search_posts(jsonb) owner to postgres;
revoke all on function internal.search_posts(jsonb) from public;
grant execute on function internal.search_posts(jsonb) to anon;
grant execute on function internal.search_posts(jsonb) to authenticated;

CREATE OR REPLACE FUNCTION internal.search_post_cards(p_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare result jsonb; cards jsonb; presentation boolean:=false; frontend boolean:=false;
begin
  if p_request ? 'ids_only' then
    raise exception 'ids_only is not a card option' using errcode='22023';
  end if;
  if p_request ? 'presentation' then
    if jsonb_typeof(p_request->'presentation') is distinct from 'boolean' then
      raise exception 'invalid presentation option' using errcode='22023';
    end if;
    presentation := (p_request->>'presentation')::boolean;
  end if;
  if p_request ? 'frontend_presentation' then
      if jsonb_typeof(p_request->'frontend_presentation') is distinct from 'boolean' then raise exception 'invalid frontend presentation option' using errcode='22023'; end if;
      frontend:=(p_request->>'frontend_presentation')::boolean;
    end if;
    if frontend and not presentation then raise exception 'presentation option required' using errcode='22023'; end if;
    result := internal.search_posts(p_request-array['presentation','frontend_presentation']);
  select coalesce(jsonb_agg(item.value||jsonb_build_object('preview',jsonb_build_object(
    'image_key',(select m.object_key from private.post_media pm join private.media_objects m on m.id=pm.object_id
      where pm.post_id=(item.value->>'id')::uuid and m.state='ready' and m.kind='image'
      order by (pm.purpose='cover') desc,pm.position limit 1),
    'video_key',(select m.object_key from private.post_media pm join private.media_objects m on m.id=pm.object_id
      where pm.post_id=(item.value->>'id')::uuid and m.state='ready' and m.kind='video' order by pm.position limit 1)
  )) || case when presentation then jsonb_build_object('presentation',jsonb_build_object(
    'business_type',(select b.business_type from private.business_details b where b.post_id=(item.value->>'id')::uuid),
    'event_window',(select jsonb_build_object(
      'starts_at',to_char(e.starts_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'ends_at',to_char(e.ends_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'timezone',e.timezone) from private.event_details e where e.post_id=(item.value->>'id')::uuid)
  ) || case when frontend then jsonb_build_object('frontend',internal.frontend_post_presentation((item.value->>'id')::uuid)) else '{}'::jsonb end) else '{}'::jsonb end order by item.ordinality),'[]'::jsonb) into cards
  from jsonb_array_elements(result->'items') with ordinality item(value,ordinality);
  return jsonb_set(result,'{items}',cards) || case when presentation then jsonb_build_object('presentation_contract','restored-public-v1') else '{}'::jsonb end;
end;
$function$;
alter function internal.search_post_cards(jsonb) owner to postgres;
revoke all on function internal.search_post_cards(jsonb) from public;
grant execute on function internal.search_post_cards(jsonb) to anon;
grant execute on function internal.search_post_cards(jsonb) to authenticated;

notify pgrst,'reload schema';
commit;
