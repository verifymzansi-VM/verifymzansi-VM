-- Business storefront (launch checklist item 17b, business tools plan section 1,
-- approved by the owner on 20 November 2026).
--
-- A Multi-listing package's live Market listings are shown on the package
-- owner's existing business page as "All stock", and each of those listings
-- names the business and links to it ("See all 18 cars"). Both only while the
-- package is running and the business has passed the business check (owner
-- decision 12 of 14 November and question 6 of the plan). There is no set-up
-- step and nothing is stored: everything is read from what exists.
--
-- From this update:
-- 1. internal.storefront_package(business) returns the package whose listings
--    the business page shows, or null. A business has a storefront when it is
--    publicly live, holds a current CIPC sticker
--    (private.frontend_current_cipc_stickers, the business check), its owner's
--    package runs now (internal.slot_package_now) and it is the owner's first
--    such business (earliest published, then id), so an owner with several
--    checked businesses has one storefront and every listing links to it.
-- 2. internal.storefront_of_post(post) returns the business whose storefront a
--    publicly live post belongs to: the business itself, or for a Market
--    listing the business of the package that holds the listing's slot (the
--    package owner's storefront business). Null otherwise.
-- 3. internal.search_posts (and so api.search_posts and api.search_post_cards,
--    which call it) accepts two more filters. 'storefront' (a business id):
--    only the Market listings that hold a slot of that business's storefront
--    package; a business without a storefront matches nothing. 'make' (1 to 80
--    characters, only with 'storefront'): listings whose vehicle make is that
--    text, in any case. Every other filter, order, page and count works as
--    before, inside the storefront too.
-- 4. New public read api.get_public_storefront(post id) (visitors and members):
--    for a business with a storefront, or a listing in one, the business id
--    and name, the number of listings, their categories with counts, the
--    vehicle makes and the property areas (province and city) among them (the
--    storefront's filter choices). Null for any other post. Only public card
--    facts: no owner, package, slot, account or contact.
--
-- Expand only: one new API command; search accepts two new optional filters;
-- no command, argument, grant or result field is removed or changed.
-- ORDER: apply first, then merge. The website reads the storefront only while
-- SHOW_BUSINESS_STOREFRONT is on (off until launch switch-on).
-- Read-only preflight: ../preflight/20261121131915_business_storefront.check.sql.
-- Rollback: ../rollback/20261121131915_business_storefront.down.sql.
begin;
-- Never wait more than 5 seconds for anything this update needs.
set local lock_timeout='5s';

-- Precondition: internal.search_posts has its reviewed body (or this
-- update's), and the new functions are all absent or all present.
do $$
declare present integer;
begin
  select (to_regprocedure('internal.storefront_package(uuid)') is not null)::integer
    + (to_regprocedure('internal.storefront_of_post(uuid)') is not null)::integer
    + (to_regprocedure('internal.get_public_storefront(uuid)') is not null)::integer
    + (to_regprocedure('api.get_public_storefront(uuid)') is not null)::integer
  into present;
  if present not in (0, 4) then
    raise exception 'business storefront precondition: % of 4 functions exist', present using errcode='55000';
  end if;
  if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc
      where oid=to_regprocedure('internal.search_posts(jsonb)'))
      not in ('47d9d7f5dc22300611d0b07dd3a998f0', '590ffdf23439ddbf6772f70afd199740') then
    raise exception 'business storefront precondition: internal.search_posts is not the reviewed body' using errcode='55000';
  end if;
end$$;

-- 1. The storefront package of a business, or null.
create or replace function internal.storefront_package(p_business uuid)
returns uuid
language sql
stable
set search_path to 'pg_catalog'
as $$
  select pk.package_id
  from private.posts b
  cross join lateral internal.slot_package_now(b.owner_id) pk
  where b.id = p_business and b.kind = 'business'
    and b.id = (
      select s.business_id from private.frontend_current_cipc_stickers s
        join private.posts o on o.id = s.business_id
      where s.owner_id = b.owner_id
        and exists(select 1 from private.public_eligible_posts e where e.id = s.business_id)
      order by o.published_at, o.id
      limit 1);
$$;
alter function internal.storefront_package(uuid) owner to postgres;
revoke all on function internal.storefront_package(uuid) from public, anon, authenticated, service_role;

-- 2. The business whose storefront a publicly live post belongs to, or null.
create or replace function internal.storefront_of_post(p_post uuid)
returns uuid
language sql
stable
set search_path to 'pg_catalog'
as $$
  select case when p.kind = 'business' then p.id else (
      select b.id from private.post_activations a
        join private.entitlements c on c.id = a.entitlement_id
        join private.slot_packages k on k.id = c.package_id
        join private.posts b on b.owner_id = k.owner_id and b.kind = 'business'
      where a.post_id = p.id and a.released_at is null
        and internal.storefront_package(b.id) = c.package_id
      limit 1) end
  from private.posts p
  where p.id = p_post and p.kind in ('business', 'listing')
    and exists(select 1 from private.public_eligible_posts e where e.id = p.id);
$$;
alter function internal.storefront_of_post(uuid) owner to postgres;
revoke all on function internal.storefront_of_post(uuid) from public, anon, authenticated, service_role;

-- 3. Search, with the 'storefront' and 'make' filters.
CREATE OR REPLACE FUNCTION internal.search_posts(p_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  req jsonb := coalesce(p_request, '{}');
  allowed text[] := array['q', 'sort', 'area', 'category', 'activity', 'province', 'city', 'price_mode',
    'min_price_cents', 'max_price_cents', 'condition', 'attributes', 'cursor', 'limit', 'offset', 'post_id', 'business_type', 'event_state', 'event_order', 'storefront', 'make'];
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
  if exists (select 1 from jsonb_each(req) e where e.key not in ('attributes', 'limit', 'offset', 'min_price_cents', 'max_price_cents')
      and jsonb_typeof(e.value) <> 'string') then
    raise exception 'search filters must be strings' using errcode = '22023';
  end if;

  if req ? 'limit' then
    if jsonb_typeof(req->'limit') <> 'number' or (req->>'limit') !~ '^[0-9]{1,2}$'
      or (req->>'limit')::integer not between 1 and 48 then
      raise exception 'limit must be 1 to 48' using errcode = '22023';
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
    'items', v_items,
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

-- 4. The storefront of a post, for its business page and its listings.
create or replace function internal.get_public_storefront(p_post_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'pg_catalog'
as $$
declare
  v_business uuid := internal.storefront_of_post(p_post_id);
  v_package uuid := internal.storefront_package(v_business);
  result jsonb;
begin
  if v_package is null then return null; end if;
  -- The same listings as search with 'storefront' (publicly visible now).
  with stock as materialized (
    select d.category_key, d.province_id, d.city_id, ld.attributes->>'make' as make
    from private.post_activations a
    join private.entitlements c on c.id = a.entitlement_id and c.package_id = v_package
    join private.post_search_documents d on d.post_id = a.post_id and d.kind = 'listing'
    join private.listing_details ld on ld.post_id = d.post_id
    where a.released_at is null and d.is_visible and d.published_at <= statement_timestamp()
      and (d.visible_until is null or d.visible_until > statement_timestamp())
      and exists(select 1 from private.public_eligible_posts e where e.id = d.post_id)
  )
  select jsonb_build_object(
    'business_id', v_business,
    'business_name', (select p.title from private.posts p where p.id = v_business),
    'listings', (select count(*) from stock),
    'categories', coalesce((select jsonb_object_agg(x.category_key, x.n)
      from (select s.category_key, count(*) as n from stock s group by s.category_key) x), '{}'::jsonb),
    'makes', coalesce((select jsonb_agg(x.make order by lower(x.make))
      from (select distinct on (lower(s.make)) s.make from stock s
        where s.category_key = 'vehicles' and nullif(btrim(s.make), '') is not null
        order by lower(s.make), s.make collate "C") x), '[]'::jsonb),
    'areas', coalesce((select jsonb_agg(jsonb_build_object('province', x.province_id, 'city', x.city_id)
        order by x.province_id, x.city_id)
      from (select distinct s.province_id, s.city_id from stock s
        where s.category_key = 'property' and s.city_id is not null) x), '[]'::jsonb))
  into result;
  return result;
end;
$$;
alter function internal.get_public_storefront(uuid) owner to postgres;

create or replace function api.get_public_storefront(p_post_id uuid)
returns jsonb
language sql
stable security invoker
set search_path to 'pg_catalog'
as $$
  select internal.get_public_storefront(p_post_id);
$$;
alter function api.get_public_storefront(uuid) owner to postgres;
revoke all on function internal.get_public_storefront(uuid), api.get_public_storefront(uuid)
  from public, anon, authenticated, service_role;
grant execute on function internal.get_public_storefront(uuid), api.get_public_storefront(uuid)
  to anon, authenticated;

commit;
