-- DEC16 public advertising contract: preserve Negotiable on amount/request
-- listings. No new filter, index, role/table grant or publication authority.
-- Non-listings, Free and jobs use false; canonical listing detail is the writer.
alter table private.post_search_documents add column price_negotiable boolean not null default false;
alter table private.post_search_documents add constraint post_search_negotiable_terms
  check (not price_negotiable or (kind='listing' and category_key<>'jobs_services'
    and coalesce(price_mode in('amount','on_request'),false)));
-- Replaying an append-only local upgrade also refreshes existing synthetic rows.
update private.post_search_documents p set price_negotiable=d.price_negotiable
from private.listing_details d where d.post_id=p.post_id and p.kind='listing';

create or replace function internal.write_post_projection(p_post_id uuid)
returns void language plpgsql security invoker set search_path = pg_catalog as $$
declare post private.posts; price record; public_facets jsonb := '{}'::jsonb;
begin
  select * into post from private.posts p where p.id = p_post_id;
  select d.price_mode, d.price_cents, d.price_negotiable into price from private.listing_details d where d.post_id = post.id;
  if post.kind = 'listing' then
    select coalesce(jsonb_object_agg(f.key, d.attributes->f.key), '{}'::jsonb) into public_facets
    from private.category_fields f join private.listing_details d on d.post_id = post.id
    where f.category_key = post.category_key and f.facet_kind is not null and d.attributes ? f.key;
  end if;
  insert into private.post_search_documents (post_id, kind, area, category_key, activity_key, province_id, city_id,
    locality_label, title, summary, price_mode, price_cents, price_negotiable, published_at, visible_until, is_visible, facets)
  values (post.id, post.kind, post.area, post.category_key, post.activity_key, post.province_id, post.city_id,
    coalesce(post.locality_label, (select c.label from private.cities c where c.id = post.city_id)),
    post.title, left(coalesce(post.description, ''), 300), price.price_mode,
    case when price.price_mode = 'on_request' then null else price.price_cents end,
    coalesce(price.price_negotiable,false),
    post.published_at, post.visible_until, post.status = 'live', public_facets)
  on conflict (post_id) do update set kind = excluded.kind, area = excluded.area,
    category_key = excluded.category_key, activity_key = excluded.activity_key, province_id = excluded.province_id,
    city_id = excluded.city_id, locality_label = excluded.locality_label, title = excluded.title,
    summary = excluded.summary, price_mode = excluded.price_mode, price_cents = excluded.price_cents, price_negotiable = excluded.price_negotiable,
    published_at = excluded.published_at, visible_until = excluded.visible_until, is_visible = excluded.is_visible,
    facets = excluded.facets;
end;
$$;

create or replace function internal.search_posts(p_request jsonb)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog as $$
declare
  req jsonb := coalesce(p_request, '{}');
  allowed text[] := array['q', 'sort', 'area', 'category', 'activity', 'province', 'city', 'price_mode',
    'min_price_cents', 'max_price_cents', 'condition', 'attributes', 'cursor', 'limit'];
  v_sort text;
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
  if exists (select 1 from jsonb_each(req) e where e.key not in ('attributes', 'limit', 'min_price_cents', 'max_price_cents')
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
  if v_sort not in ('relevance', 'newest') or (v_sort = 'relevance' and v_terms is null) then
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
    select d.*,
      case when v_sort = 'relevance' then round((
        0.75 * (ts_rank(d.document, v_tsquery, 32)
          + coalesce((select avg(extensions.word_similarity(t, d.search_text)) from unnest(v_terms) t), 0)) / 2
        + 0.25 / (1 + greatest(extract(epoch from (v_asof - d.published_at)), 0) / 2592000.0)
      )::numeric, 6) end as score
    from private.post_search_documents d
    where d.is_visible
      and exists(select 1 from private.public_eligible_posts eligible where eligible.id=d.post_id)
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
    order by case when v_sort = 'relevance' then s.score end desc nulls last, s.published_at desc, s.post_id desc
    limit v_limit + 1
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
    'next_cursor', case when v_has_more then
      translate(encode(convert_to(jsonb_build_object('at', v_items->(v_limit - 1)->>'published_at',
        'id', v_items->(v_limit - 1)->>'id', 'score', v_items->(v_limit - 1)->>'score',
        'sort', v_sort, 'asof', v_asof, 'sig', v_signature)::text, 'UTF8'), 'base64'), E'+/\n', '-_')
      end
  );
end;
$$;

create or replace function internal.get_public_post(p_id uuid)
returns jsonb language sql stable security definer set search_path = pg_catalog as $$
  select jsonb_build_object('id', p.id, 'kind', p.kind, 'area', p.area, 'category', p.category_key,
    'activity', p.activity_key, 'title', p.title, 'description', p.description, 'province', p.province_id,
    'city', p.city_id, 'locality', d.locality_label, 'price_mode', d.price_mode, 'price_cents', d.price_cents::text,
    'price_negotiable', d.price_negotiable,
    'published_at', p.published_at, 'visible_until', p.visible_until,
    'condition', case when p.kind='listing' then d.facets->>'condition' end,
    'media', coalesce((select jsonb_agg(jsonb_build_object('purpose', pm.purpose, 'position', pm.position,
        'object_key', m.object_key, 'kind', m.kind, 'width', m.width, 'height', m.height,
        'focal_x', pm.focal_x, 'focal_y', pm.focal_y) order by pm.purpose, pm.position)
      from private.post_media pm join private.media_objects m on m.id = pm.object_id
      where pm.post_id = p.id and m.state = 'ready'), '[]'))
  from private.posts p join private.post_search_documents d on d.post_id = p.id
  where p.id = p_id and d.is_visible and (d.visible_until is null or d.visible_until>statement_timestamp())
    and exists(select 1 from private.public_eligible_posts eligible where eligible.id=p.id);
$$;
revoke all on function internal.write_post_projection(uuid) from public;
revoke all on function internal.search_posts(jsonb) from public;
revoke all on function internal.get_public_post(uuid) from public;
