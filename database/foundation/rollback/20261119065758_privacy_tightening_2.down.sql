-- Reviewed rollback for updates/20261119065758_privacy_tightening_2.sql.
-- Not part of the replay. Run it only if that update must be undone, after the
-- owner has decided so. Prefer a forward fix.
--
-- It puts back the earlier bodies of the thirteen functions the update replaced
-- byte for byte (same signatures, grants and owners), drops
-- internal.business_check_reread_open and restores the partner rate check
-- (0 to 5,000 basis points). No row is changed. The website from the same
-- pull request keeps working: it reads the staff organisation detail with
-- 'public_contacts' again (shown inline), and it already keeps search pages,
-- partner rates and communication choices within the update's limits. It
-- refuses (55000) unless every function has this update's body (a later
-- update changed one: undo that update first).
begin;
set local lock_timeout='5s';

do $$
declare shape text;
begin
  for shape in
    select v.sig||' '||coalesce((select md5(replace(p.prosrc,E'\r\n',E'\n')) from pg_proc p where p.oid=to_regprocedure(v.sig)),'absent')
    from (values
      ('internal.save_my_communication_choices(text,boolean,boolean,boolean,boolean)'),
      ('internal.staff_dashboard_overview()'),
      ('internal.restored_staff_queues()'),
      ('internal.search_posts(jsonb)'),
      ('internal.staff_save_partner(uuid,text,text,integer,text)'),
      ('internal.get_frontend_enforcement()'),
      ('internal.get_frontend_partner_admin()'),
      ('internal.staff_get_organisation(uuid)'),
      ('internal.get_frontend_staff_organisation_detail(uuid)'),
      ('internal.get_frontend_cipc_case(uuid)'),
      ('internal.get_frontend_seen_case(uuid)'),
      ('internal.authorize_frontend_seen_file(uuid,boolean)'),
      ('internal.account_closing_actor()'),
      ('internal.business_check_reread_open(timestamp with time zone)')) v(sig)
  loop
    if shape not in (
        'internal.save_my_communication_choices(text,boolean,boolean,boolean,boolean) 108eb16e62297bf4efe5b7502c3dca31',
        'internal.staff_dashboard_overview() 575b368298007e14e2935224362ac0b8',
        'internal.restored_staff_queues() eeabf5112eaca63d3f0285dbb1e54ac8',
        'internal.search_posts(jsonb) 47d9d7f5dc22300611d0b07dd3a998f0',
        'internal.staff_save_partner(uuid,text,text,integer,text) 84211230f68fc91ae0bc3e5545b64ede',
        'internal.get_frontend_enforcement() a712dfc620272856484dc35a253698df',
        'internal.get_frontend_partner_admin() 0cb0d98d06162be7a9d34fe902127f4f',
        'internal.staff_get_organisation(uuid) 98da242d11190c87c4c7a79663fad30c',
        'internal.get_frontend_staff_organisation_detail(uuid) 7e9eb158699413b43d63d30b86441400',
        'internal.get_frontend_cipc_case(uuid) d6047d65ff244d349a63273a354d162c',
        'internal.get_frontend_seen_case(uuid) a1a42c71ed078d188ebe94a2e9ac4bb5',
        'internal.authorize_frontend_seen_file(uuid,boolean) 7a51ab618ce14a97309fdb50fd21acea',
        'internal.account_closing_actor() f693dcfec7976a87e42941286d8b2305',
        'internal.business_check_reread_open(timestamp with time zone) 257483078d7b7b9a21d81fc6680ab2cd') then
      raise exception 'rollback precondition: % is not this update''s body', shape using errcode='55000';
    end if;
  end loop;
end$$;

CREATE OR REPLACE FUNCTION internal.save_my_communication_choices(p_wording text, p_marketing_email boolean DEFAULT NULL::boolean, p_marketing_sms boolean DEFAULT NULL::boolean, p_analytics boolean DEFAULT NULL::boolean, p_third_party_sharing boolean DEFAULT NULL::boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.consent_actor(); current_choices jsonb; wanted jsonb; grants integer; recent integer;
begin
  if p_wording is null or p_wording !~ '^[a-z0-9][a-z0-9-]{0,39}$' then
    raise exception 'invalid wording version' using errcode='22023', detail='choice_invalid';
  end if;
  if num_nonnulls(p_marketing_email, p_marketing_sms, p_analytics, p_third_party_sharing) = 0 then
    raise exception 'no choice given' using errcode='22023', detail='choice_invalid';
  end if;
  -- One save at a time per account, then the caller check again after the wait.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text, 1707));
  perform internal.consent_actor();
  current_choices:=internal.communication_choices_dto(actor);
  wanted:=jsonb_strip_nulls(jsonb_build_object('marketing_email', p_marketing_email,
    'marketing_sms', p_marketing_sms, 'analytics', p_analytics, 'third_party_sharing', p_third_party_sharing));
  -- Turning a choice on needs an active account and counts towards the daily
  -- limit; turning one off never does.
  select count(*) into grants from jsonb_each(wanted) w
    where w.value is distinct from current_choices -> w.key and w.value = 'true'::jsonb;
  if grants > 0 then
    perform internal.price_draft_actor();
    select count(*) into recent from private.communication_choice_events e
      where e.account_id = actor and e.granted and e.recorded_at > statement_timestamp() - interval '24 hours';
    if recent + grants > 20 then
      raise exception 'too many changes today; try again tomorrow' using errcode='PT429', detail='choice_limit';
    end if;
  end if;
  if exists(select 1 from jsonb_each(wanted) w where w.value is distinct from current_choices -> w.key) then
    insert into private.communication_choice_events (account_id, purpose, granted, wording_version)
      select actor, w.key, w.value::boolean, p_wording from jsonb_each(wanted) w
      where w.value is distinct from current_choices -> w.key
      order by w.key;
  end if;
  return internal.communication_choices_dto(actor);
end;
$function$;
alter function internal.save_my_communication_choices(text,boolean,boolean,boolean,boolean) owner to postgres;
revoke all on function internal.save_my_communication_choices(text,boolean,boolean,boolean,boolean) from public;
grant execute on function internal.save_my_communication_choices(text,boolean,boolean,boolean,boolean) to authenticated;

CREATE OR REPLACE FUNCTION internal.staff_dashboard_overview()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('queue:view'); staff_role text; claims jsonb;
begin
  select r.role into strict staff_role from private.staff_roles r
    where r.user_id=actor and r.revoked_at is null;
  select coalesce(jsonb_agg(jsonb_build_object(
    'subject_id',c.subject_id,'kind',c.kind,'expires_at',c.expires_at)
    order by c.expires_at,c.subject_id),'[]'::jsonb) into claims
  from (
    select coalesce(q.post_id,q.report_id) as subject_id,
      case when q.post_id is not null then 'content' else 'report' end as kind,
      q.claim_expires_at as expires_at
    from private.queue_claims q where q.claimed_by=actor and q.claim_expires_at>statement_timestamp()
    union all
    select e.id,'identity',e.claim_expires_at from private.evidence_cases e
      where e.claimed_by=actor and e.claim_expires_at>statement_timestamp()
    order by expires_at,subject_id limit 40
  ) c;
  -- Selected frontend queue presentation, from canonical private records.
  return internal.restored_staff_queues() || jsonb_build_object(
    'version',1,'role',staff_role,'generated_at',statement_timestamp(),
    'counts',jsonb_build_object(
      'reports',(select count(*) from private.reports r where r.status='open'),
      'content',(select count(*) from private.posts p where p.status='pending_moderation'),
      'kyc',(select count(*) from private.evidence_cases e where e.status='open' and e.kind='kyc'),
      'business_kyc',(select count(*) from private.evidence_cases e where e.status='open' and e.kind='business'),
      'decisions',(select count(*) from private.decisions d where d.status='proposed')),
    'claims',claims,
    'platform',case when staff_role='admin' then jsonb_build_object(
      'jobs_waiting',(select count(*) from private.outbox_events o where o.processed_at is null),
      'cost_alarms',(select count(*) from private.cost_alarms a where a.acknowledged_at is null),
      'active_staff',(select count(*) from private.staff_roles r where r.revoked_at is null)) else null end
  );
end;
$function$;
alter function internal.staff_dashboard_overview() owner to postgres;
revoke all on function internal.staff_dashboard_overview() from public;
grant execute on function internal.staff_dashboard_overview() to authenticated;

CREATE OR REPLACE FUNCTION internal.restored_staff_queues()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('queue:view'); reports jsonb; kyc jsonb; content jsonb; business jsonb;
begin
  select jsonb_build_object('open',count(*),'oldest_at',min(r.created_at),
    'breached',count(*) filter(where r.created_at<statement_timestamp()-case when r.severity='high' then interval '4 hours' else interval '24 hours' end),
    'claimed',(select count(*) from private.queue_claims q join private.reports r2 on r2.id=q.report_id
      where r2.status='open' and q.claim_expires_at>statement_timestamp())) into reports
    from private.reports r where r.status='open';
  select jsonb_build_object('pending',count(*),'oldest_at',min(e.created_at),
    'high_risk',count(*) filter(where exists(select 1 from private.verification_current_submissions c
      join private.verification_identity_submissions s on s.id=c.submission_id
      where s.case_id=e.id and s.risk_score>50)),
    'claimed',count(*) filter(where e.claim_expires_at>statement_timestamp())) into kyc
    from private.evidence_cases e where e.kind='kyc' and e.status='open';
  select jsonb_build_object('pending',count(*),'oldest_at',min(p.submitted_at),
    'claimed',(select count(*) from private.queue_claims q join private.posts p2 on p2.id=q.post_id
      where p2.status='pending_moderation' and q.claim_expires_at>statement_timestamp())) into content
    from private.posts p where p.status='pending_moderation';
  select jsonb_build_object('pending',count(*),'oldest_at',min(e.created_at),
    'breached',count(*) filter(where e.created_at<statement_timestamp()-interval '24 hours'),
    'claimed',count(*) filter(where e.claim_expires_at>statement_timestamp())) into business
    from private.evidence_cases e where e.kind='business' and e.status='open';
  return jsonb_build_object('restored_queues',jsonb_build_object(
    'reports',reports,'kyc',kyc,'content',content,'business_kyc',business,'support',null));
end;
$function$;
alter function internal.restored_staff_queues() owner to postgres;
revoke all on function internal.restored_staff_queues() from public;

CREATE OR REPLACE FUNCTION internal.search_posts(p_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  req jsonb := coalesce(p_request, '{}');
  allowed text[] := array['q', 'sort', 'area', 'category', 'activity', 'province', 'city', 'price_mode',
    'min_price_cents', 'max_price_cents', 'condition', 'attributes', 'cursor', 'limit', 'offset', 'post_id', 'business_type', 'event_state', 'event_order'];
  v_sort text;
  v_offset integer := 0;
  v_post_id uuid;
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
      or (req->>'offset')::integer > 500000 or req ? 'cursor' then
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

CREATE OR REPLACE FUNCTION internal.staff_save_partner(p_account uuid, p_action text, p_code text, p_commission_bps integer, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('partner:manage'); p private.partners;
begin
  perform internal.organisation_reason(p_reason);
  if p_account is null or p_account=actor then
    raise exception 'staff cannot manage their own partner record' using errcode='42501',detail='self_partner'; end if;
  perform internal.lock_verification_subject(p_account);
  select * into p from private.partners x where x.account_id=p_account for update;
  actor:=internal.staff_actor('partner:manage');
  if p_commission_bps is not null and p_commission_bps not between 0 and 5000 then
    raise exception 'invalid rate' using errcode='22023',detail='partner_invalid'; end if;
  if p_action='create' then
    if p.id is not null then raise exception 'already a partner' using errcode='PT409',detail='partner_exists'; end if;
    if p_code is null or p_code !~ '^[A-Z0-9]{4,16}$' then
      raise exception 'invalid code' using errcode='22023',detail='partner_invalid'; end if;
    if not exists(select 1 from private.current_account_access u where u.id=p_account) then
      raise exception 'account unavailable' using errcode='PT409',detail='partner_account_unavailable'; end if;
    if exists(select 1 from private.partners x where x.code=p_code) then
      raise exception 'code taken' using errcode='PT409',detail='partner_code_taken'; end if;
    insert into private.partners(account_id,code,commission_bps,created_by) values(p_account,p_code,p_commission_bps,actor)
      returning * into p;
  elsif p.id is null then
    raise exception 'partner not found' using errcode='PT404',detail='partner_unavailable';
  elsif p_action='activate' then
    if internal.current_verified_identity(p_account) is null then
      raise exception 'verified identity required' using errcode='PT409',detail='verification_required'; end if;
    update private.partners set status='active',revision=revision+1,updated_at=statement_timestamp()
      where id=p.id returning * into p;
  elsif p_action='suspend' then
    update private.partners set status='suspended',revision=revision+1,updated_at=statement_timestamp()
      where id=p.id returning * into p;
  elsif p_action='set_rate' then
    update private.partners set commission_bps=p_commission_bps,revision=revision+1,updated_at=statement_timestamp()
      where id=p.id returning * into p;
  else
    raise exception 'unknown action' using errcode='22023',detail='partner_invalid';
  end if;
  insert into private.partner_events(partner_id,actor_id,action,reason) values(p.id,actor,'partner_'||p_action,p_reason);
  return jsonb_build_object('id',p.id,'code',p.code,'status',p.status,'commission_bps',p.commission_bps,
    'revision',p.revision);
end;
$function$;
alter function internal.staff_save_partner(uuid,text,text,integer,text) owner to postgres;
revoke all on function internal.staff_save_partner(uuid,text,text,integer,text) from public;
grant execute on function internal.staff_save_partner(uuid,text,text,integer,text) to authenticated;

CREATE OR REPLACE FUNCTION internal.get_frontend_enforcement()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('account:restore');now_at timestamptz:=clock_timestamp();result jsonb;
begin
  with active as materialized (
    select x.id,x.decision_id,x.account_id,x.kind,x.reason,x.starts_at,x.ends_at,x.emergency,x.version,
      coalesce(actor in(x.account_id,x.reporter_id,d.proposed_by,d.approved_by),false) as conflicted,p.display_name
      from private.frontend_account_restrictions x join private.decisions d on d.id=x.decision_id
      left join private.profiles p on p.account_id=x.account_id
      where x.lifted_at is null and (x.ends_at is null or x.ends_at>now_at)
    union all
    select d.id,d.id,c.subject_id,'ban','Account restricted after an independent review.',d.approved_at,null,false,null,true,p.display_name
      from private.decisions d join private.evidence_cases c on c.id=d.case_id
      left join private.profiles p on p.account_id=c.subject_id
      where d.action='restrict_account' and d.scope_kind='native' and d.status='approved' and not exists(select 1 from private.frontend_account_restrictions y where y.decision_id=d.id and not y.emergency)
  ), history as (
    select a.id::text id,a.action,r.subject_account_id account_id,a.reason,a.created_at
      from private.frontend_report_action_receipts a join private.reports r on r.id=a.report_id where a.action in('warn','hide') and a.status='applied'
    union all
    select 'restriction:'||x.id,case when x.emergency then 'emergency suspension' else x.kind end,x.account_id,x.reason,x.starts_at
      from private.frontend_account_restrictions x
    union all
    select 'lift:'||x.id,'lift',x.account_id,x.lift_reason,x.lifted_at
      from private.frontend_account_restrictions x where x.lifted_at is not null
    union all
    select 'restriction:'||d.id,'ban',c.subject_id,'Account restricted after an independent review.',d.approved_at
      from private.decisions d join private.evidence_cases c on c.id=d.case_id
      where d.action='restrict_account' and d.scope_kind='native' and d.status='approved' and not exists(select 1 from private.frontend_account_restrictions y where y.decision_id=d.id and not y.emergency)
  ) select jsonb_build_object('actor_id',actor,
    'total',(select count(*) from active),
    'suspensions',(select count(*) from active where kind='suspension'),
    'bans',(select count(*) from active where kind='ban'),
    'emergency',(select count(*) from active where emergency),
    'items',coalesce((select jsonb_agg(to_jsonb(x) order by x.starts_at desc,x.id desc) from
      (select * from active order by starts_at desc,id desc limit 50)x),'[]'::jsonb),
    'recent',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id desc) from
      (select * from history order by created_at desc,id desc limit 20)x),'[]'::jsonb)
  ) into result;
  perform internal.staff_actor('account:restore');return result;
end$function$;
alter function internal.get_frontend_enforcement() owner to postgres;
revoke all on function internal.get_frontend_enforcement() from public;
grant execute on function internal.get_frontend_enforcement() to authenticated;

CREATE OR REPLACE FUNCTION internal.get_frontend_partner_admin()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('partner:manage');result jsonb;
begin
  select jsonb_build_object('actor_id',actor,'default_rate_bps',2000,
    'partners',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id desc) from (
      select p.id,p.account_id,p.code,p.status,p.commission_bps,p.created_at,pr.display_name,
        (select count(*) from private.account_acquisitions a where a.partner_id=p.id) referrals
      from private.partners p left join private.profiles pr on pr.account_id=p.account_id order by p.created_at desc,p.id desc limit 500)x),'[]'::jsonb),
    'commissions',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id desc) from (
      select c.id,c.partner_id,p.code partner_code,c.base_cents::text,c.amount_cents::text,c.rate_bps,c.status,c.eligible_at,c.created_at,pay.status payment_status
      from private.partner_commissions c join private.partners p on p.id=c.partner_id
      join private.payments pay on pay.id=c.payment_id order by c.created_at desc,c.id desc limit 200)x),'[]'::jsonb)
  ) into result;
  perform internal.staff_actor('partner:manage');return result;
end$function$;
alter function internal.get_frontend_partner_admin() owner to postgres;
revoke all on function internal.get_frontend_partner_admin() from public;
grant execute on function internal.get_frontend_partner_admin() to authenticated;

CREATE OR REPLACE FUNCTION internal.staff_get_organisation(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('organisation:manage'); o private.organisations;
begin
  select * into o from private.organisations where id=p_id;
  if not found then return null; end if;
  return to_jsonb(o)-'created_by'-'logo_permission_by'||jsonb_build_object(
    'logo_object_key',(select m.object_key from private.media_objects m where m.id=o.logo_object_id),
    'admins',coalesce((select jsonb_agg(jsonb_build_object('account_id',a.account_id,'role',a.role,
      'display_name',p.display_name,'created_at',a.created_at) order by a.created_at)
      from private.organisation_admins a left join private.profiles p on p.account_id=a.account_id
      where a.organisation_id=o.id),'[]'),
    'open_invites',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'email',internal.mask_email(i.email),
      'expires_at',i.expires_at) order by i.created_at) from private.organisation_invites i
      where i.organisation_id=o.id and i.accepted_at is null and i.revoked_at is null
        and i.expires_at>statement_timestamp()),'[]'),
    'programmes',coalesce((select jsonb_agg(jsonb_build_object('id',pr.id,'slug',pr.slug,'name',pr.name,
      'active',pr.active) order by pr.name) from private.organisation_programmes pr where pr.organisation_id=o.id),'[]'),
    'active_affiliations',(select count(*) from private.organisation_affiliations f
      where f.organisation_id=o.id and f.status='active'),
    'open_applications',(select count(*) from private.organisation_applications a
      where a.organisation_id=o.id and a.status in('submitted','more_info_required')),
    'notes',coalesce((select jsonb_agg(jsonb_build_object('id',n.id,'note',n.note,'created_at',n.created_at)
      order by n.created_at desc) from (select * from private.organisation_notes n where n.organisation_id=o.id
      order by n.created_at desc limit 50) n),'[]'));
end;
$function$;
alter function internal.staff_get_organisation(uuid) owner to postgres;
revoke all on function internal.staff_get_organisation(uuid) from public;
grant execute on function internal.staff_get_organisation(uuid) to authenticated;

CREATE OR REPLACE FUNCTION internal.get_frontend_staff_organisation_detail(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare detail jsonb;contacts jsonb;
begin
  perform internal.staff_actor('organisation:manage');
  detail:=internal.staff_get_organisation(p_id);
  if detail is null then return null;end if;
  select coalesce(jsonb_agg(jsonb_build_object('application_id',a.id,
    'phone',p.contacts->>'phone','email',p.data->>'email','website',p.data->>'website')
    order by a.created_at desc,a.id),'[]'::jsonb) into contacts
    from (select x.id,x.post_id,x.created_at from private.organisation_applications x
      where x.organisation_id=p_id and x.status<>'withdrawn'
      order by x.created_at desc,x.id limit 200)a
    join private.public_eligible_posts e on e.id=a.post_id
    join private.post_presentations p on p.post_id=e.id;
  perform internal.staff_actor('organisation:manage');
  return detail||jsonb_build_object('public_contacts',contacts);
end$function$;
alter function internal.get_frontend_staff_organisation_detail(uuid) owner to postgres;
revoke all on function internal.get_frontend_staff_organisation_detail(uuid) from public;
grant execute on function internal.get_frontend_staff_organisation_detail(uuid) to authenticated;

CREATE OR REPLACE FUNCTION internal.get_frontend_cipc_case(p_case uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('queue:view');x private.frontend_business_checks;c private.evidence_cases;
  d private.frontend_cipc_reviews;owner_doc private.frontend_cipc_documents;official_doc private.frontend_cipc_documents;
  root private.frontend_current_cipc_stickers;exception_row private.frontend_cipc_exceptions;permitted boolean;
  result jsonb;missing text[]:='{}';hard text[]:='{}';ids uuid[];role_text text;position_text text;company_name text;
begin
  select * into x from private.frontend_business_checks where id=p_case and kind in('cipc','cipc_link');
  if not found then return null;end if;
  perform internal.lock_verification_subject(x.owner_id);
  select * into x from private.frontend_business_checks where id=p_case and kind in('cipc','cipc_link');
  if not found then return null;end if;
  select * into d from private.frontend_cipc_reviews where check_id=x.id and submitted_at is not null;
  if not found then return null;end if;
  select * into c from private.evidence_cases where id=x.id;
  permitted:=actor<>x.owner_id and coalesce(actor=x.reviewed_by or (c.status='open' and c.claimed_by=actor and c.claim_expires_at>clock_timestamp()),false);
  if permitted then
    perform internal.staff_actor('evidence:view');
    select * into owner_doc from private.frontend_cipc_documents where artifact_id=d.owner_file;
    select * into official_doc from private.frontend_cipc_documents where artifact_id=d.official_file;
    select * into exception_row from private.frontend_cipc_exceptions where check_id=x.id and official_file=d.official_file;
    select coalesce(array_agg(e.artifact_id),'{}') into ids from private.frontend_cipc_documents e join private.evidence_artifacts a on a.id=e.artifact_id
      where e.check_id=x.id and e.recorded_at is not null and a.state='clean' and (a.retain_until is null or a.retain_until>clock_timestamp());
    insert into private.evidence_access_log(staff_id,case_id,purpose,case_version,claim_generation,artifact_ids)
      values(actor,c.id,'routine_review',c.version,c.claim_generation,ids);
    if x.kind='cipc_link' then
      select * into root from private.frontend_current_cipc_stickers s where s.business_id=d.linked_business_id
        and s.owner_id=x.owner_id and s.registration_number=d.registration_number and s.kind='cipc';
      if not found then hard:=array_append(hard,'The source profile no longer holds a current CIPC sticker.');end if;
      company_name:=root.registered_name;role_text:=root.accepted_role;position_text:=root.position_title;
    else
      if official_doc.artifact_id is null or not (official_doc.artifact_id=any(ids)) then
        hard:=array_append(hard,'Attach the current copy you fetched from CIPC.');
      elsif official_doc.summary->>'registrationNumber' is distinct from d.registration_number then
        hard:=array_append(hard,'The official copy is for a different registration number.');
      elsif lower(btrim(official_doc.summary->>'enterpriseStatus')) is distinct from 'in business' then
        hard:=array_append(hard,'The official register must show the company as In Business.');
      end if;
      company_name:=official_doc.summary->>'registeredName';
      if d.route='representative' then
        if d.representative_verified_at is null or not d.domain_confirmed or not d.callback_confirmed then
          hard:=array_append(hard,'Confirm the representative by work email and independent callback.');
        end if;
        role_text:='representative';position_text:=d.representative_position;
      elsif official_doc.owner_match_fingerprint is null or not exists(select 1 from private.accepted_identity_facts f
        where f.owner_id=x.owner_id and f.identity_hmac=official_doc.owner_match_fingerprint and f.revoked_at is null) then
        if internal.frontend_cipc_legal_name_match(x.owner_id,official_doc.summary) then
          missing:=array_append(missing,'The official copy does not include a matching ID. A second reviewer must confirm the unique legal name.');
        else hard:=array_append(hard,'The current owner does not match a director on the official copy.');end if;
      else
        role_text:=case when official_doc.owner_match_position ilike '%member%' then 'member' else 'director' end;
        position_text:=official_doc.owner_match_position;
      end if;
    end if;
    if exists(select 1 from private.frontend_current_cipc_stickers s where s.registration_number=d.registration_number and s.owner_id<>x.owner_id)
      then hard:=array_append(hard,'Another owner already holds this registration.');end if;
    if not internal.frontend_business_identity_reviewed(x.owner_id) then hard:=array_append(hard,'The owner needs a current ID review.');end if;
  else hard:=array_append(hard,'Claim this case to inspect the private review details.');end if;
  missing:=hard||missing;
  select jsonb_build_object('id',x.id,'ownerId',x.owner_id,'kind',x.kind,'route',d.route,'status',case when x.revoked_at is not null then 'revoked' else x.status end,
    'registrationNumber',d.registration_number,'createdAt',x.created_at,'updatedAt',x.updated_at,'decidedAt',x.decided_at,'expiresAt',x.expires_at,
    'reasonCode',x.reason_code,'reviewNote',case when permitted then x.review_note end,
    'business',jsonb_build_object('id',p.id,'business_name',p.title,'slug',s.slug,'status',p.status,'location_city',city.label,'location_province',prov.label),
    'owner',jsonb_build_object('displayName',internal.profile_public_name(pr.display_name),'legalName',case when permitted then nullif(concat_ws(' ',pr.legal_first_name,pr.legal_last_name),'') end,
      'idReviewed',internal.frontend_business_identity_reviewed(x.owner_id)),
    'parsed',owner_doc.summary,'official',official_doc.summary,
    'office',case when permitted then coalesce(d.office_override,d.registered_office,nullif(official_doc.summary->'registeredOffice','null'::jsonb),nullif(owner_doc.summary->'registeredOffice','null'::jsonb)) end,
    'representative',case when permitted and d.route='representative' then jsonb_build_object('email',d.representative_email,'position',d.representative_position,
      'emailVerifiedAt',d.representative_verified_at,'domainConfirmed',d.domain_confirmed,'callback',d.callback_record,
      'confirmed',d.representative_verified_at is not null and d.domain_confirmed and d.callback_confirmed) end,
    'exception',case when exception_row.check_id is not null then jsonb_build_object('proposedBy',exception_row.proposed_by,'confirmedBy',exception_row.confirmed_by,'reason',exception_row.reason) end,
    'evidence',jsonb_build_object('ready',cardinality(missing)=0,'missing',missing,'unwaivable',hard,'role',role_text,'position',position_text,'registeredName',company_name),
    'files',case when permitted then coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'kind',e.source,'content_type','application/pdf',
      'size_bytes',a.size_bytes,'created_at',a.created_at,'quarantined',false,'purged_at',a.deleted_at) order by a.created_at,a.id)
      from private.evidence_artifacts a join private.frontend_cipc_documents e on e.artifact_id=a.id where a.id=any(ids)),'[]'::jsonb) else '[]'::jsonb end,
    'messages',case when permitted then coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'author_id',m.author_id,
      'author_role',m.author_role,'body',m.body,'created_at',m.created_at,'attachment_file_id',case when m.attachment_file_id=any(ids) then m.attachment_file_id end)
      order by m.created_at,m.id) from (select * from private.frontend_business_check_messages where check_id=x.id order by created_at desc,id desc limit 100)m),'[]'::jsonb) else '[]'::jsonb end,
    'accessLog',case when permitted then coalesce((select jsonb_agg(jsonb_build_object('actor_id',a.staff_id,'action',a.purpose,'created_at',a.accessed_at) order by a.accessed_at desc)
      from (select * from private.evidence_access_log where case_id=x.id order by accessed_at desc limit 10)a),'[]'::jsonb) else '[]'::jsonb end)
  into result from private.posts p left join private.post_slugs s on s.post_id=p.id left join private.profiles pr on pr.account_id=x.owner_id
    left join private.cities city on city.id=p.city_id left join private.provinces prov on prov.id=p.province_id
    where p.id=x.business_id and p.owner_id=x.owner_id;
  perform internal.staff_actor('queue:view');return result;
end$function$;
alter function internal.get_frontend_cipc_case(uuid) owner to postgres;
revoke all on function internal.get_frontend_cipc_case(uuid) from public;
grant execute on function internal.get_frontend_cipc_case(uuid) to authenticated;

CREATE OR REPLACE FUNCTION internal.get_frontend_seen_case(p_case uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('queue:view');answer jsonb;x private.frontend_business_checks;ec private.evidence_cases;private_read boolean:=false;ids uuid[];
begin
  select * into x from private.frontend_business_checks where id=p_case and kind='seen';
  if not found then return null;end if;
  perform internal.lock_verification_subject(x.owner_id);
  select * into x from private.frontend_business_checks where id=p_case and kind='seen';
  if not found then return null;end if;
  select * into ec from private.evidence_cases where id=x.id;
  if actor<>x.owner_id and (actor=x.assigned_to or actor=x.reviewed_by or
    (ec.status='open' and ec.claimed_by=actor and ec.claim_expires_at>clock_timestamp())) then
    perform internal.staff_actor('evidence:view');private_read:=true;
  end if;
  if private_read then
    select coalesce(array_agg(p.artifact_id),'{}') into ids from private.frontend_business_seen_files p join private.evidence_artifacts a on a.id=p.artifact_id
      where p.check_id=x.id and a.state='clean' and (a.retain_until is null or a.retain_until>clock_timestamp());
    insert into private.evidence_access_log(staff_id,case_id,purpose,case_version,claim_generation,artifact_ids)
      values(actor,ec.id,'routine_review',ec.version,ec.claim_generation,ids);
  end if;
  select jsonb_build_object('id',x.id,'ownerId',x.owner_id,'kind','seen','status',x.status,'createdAt',x.created_at,'updatedAt',x.updated_at,
    'decidedAt',x.decided_at,'expiresAt',x.expires_at,'reviewNote',case when private_read then x.review_note end,'reasonCode',x.reason_code,
    'business',jsonb_build_object('id',p.id,'business_name',p.title,'slug',s.slug,'status',p.status,'location_city',city.label,'location_province',prov.label),
    'owner',jsonb_build_object('displayName',internal.profile_public_name(pr.display_name),'legalName',case when private_read then nullif(concat_ws(' ',pr.legal_first_name,pr.legal_last_name),'') end,
      'idReviewed',internal.frontend_business_identity_reviewed(x.owner_id)),
    'seen',jsonb_build_object('method',x.seen_method,'address',case when private_read then x.visit_address end,
      'slots',case when private_read then x.available_slots end,'assignedTo',x.assigned_to,'scheduledFor',x.scheduled_for,
      'photos',case when private_read then coalesce((select jsonb_agg(jsonb_build_object('fileId',ph.artifact_id,'by',ph.verifier_id,'takenAt',ph.created_at,
        'lat',ph.latitude,'lng',ph.longitude) order by ph.created_at,ph.artifact_id) from private.frontend_business_seen_photos ph
        where ph.artifact_id=any(ids)),'[]'::jsonb) else '[]'::jsonb end,
      'report',case when private_read and x.visit_report is not null then x.visit_report||jsonb_build_object('by',x.report_by,'at',x.report_at) end),
    'files',case when private_read then coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'kind',ph.kind,
      'content_type',ph.mime,'size_bytes',a.size_bytes,'created_at',a.created_at,'quarantined',false,'purged_at',a.deleted_at)
      order by a.created_at,a.id) from private.evidence_artifacts a join private.frontend_business_seen_files ph on ph.artifact_id=a.id
      where a.id=any(ids)),'[]'::jsonb) else '[]'::jsonb end,
    'messages',case when private_read then coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'author_id',m.author_id,
      'author_role',m.author_role,'body',m.body,'created_at',m.created_at,'attachment_file_id',case when m.attachment_file_id=any(ids) then m.attachment_file_id end) order by m.created_at,m.id)
      from (select * from private.frontend_business_check_messages where check_id=x.id order by created_at desc,id desc limit 100)m),'[]'::jsonb)
      else '[]'::jsonb end)
  into answer from private.posts p left join private.post_slugs s on s.post_id=p.id left join private.profiles pr on pr.account_id=x.owner_id
    left join private.cities city on city.id=p.city_id left join private.provinces prov on prov.id=p.province_id
    where p.id=x.business_id and p.owner_id=x.owner_id;
  perform internal.staff_actor('queue:view');return answer;
end$function$;
alter function internal.get_frontend_seen_case(uuid) owner to postgres;
revoke all on function internal.get_frontend_seen_case(uuid) from public;
grant execute on function internal.get_frontend_seen_case(uuid) to authenticated;

CREATE OR REPLACE FUNCTION internal.authorize_frontend_seen_file(p_artifact uuid, p_record boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=internal.staff_actor('evidence:view');subject uuid;check_id uuid;x private.frontend_business_checks;c private.evidence_cases;
begin
  select b.id,b.owner_id into check_id,subject from private.frontend_business_seen_files ph join private.frontend_business_checks b on b.id=ph.check_id
    where ph.artifact_id=p_artifact;
  if subject is null then raise exception 'photo not available' using errcode='PT404';end if;
  perform internal.lock_verification_subject(subject);actor:=internal.staff_actor('evidence:view');
  select * into x from private.frontend_business_checks where id=check_id;
  select * into c from private.evidence_cases where id=check_id;
  if actor=subject or not coalesce(actor=x.assigned_to or actor=x.reviewed_by
    or (c.status='open' and c.claimed_by=actor and c.claim_expires_at>clock_timestamp()),false)
    then raise exception 'an authorized verifier must view this photo' using errcode='42501';end if;
  if not exists(select 1 from private.evidence_artifacts a where a.id=p_artifact and a.case_id=c.id and a.state='clean'
      and (a.retain_until is null or a.retain_until>clock_timestamp()))
    then raise exception 'photo not available' using errcode='PT404';end if;
  if p_record then
    insert into private.evidence_access_log(staff_id,case_id,purpose,case_version,claim_generation,artifact_ids)
      values(actor,c.id,'routine_review',c.version,c.claim_generation,array[p_artifact]);
  end if;
  perform internal.staff_actor('evidence:view');return jsonb_build_object('case_id',c.id,'version',c.version,'artifact_id',p_artifact);
end$function$;
alter function internal.authorize_frontend_seen_file(uuid,boolean) owner to postgres;
revoke all on function internal.authorize_frontend_seen_file(uuid,boolean) from public;
grant execute on function internal.authorize_frontend_seen_file(uuid,boolean) to authenticated;

CREATE OR REPLACE FUNCTION internal.account_closing_actor()
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid := auth.uid(); claims jsonb := auth.jwt(); signed_in_at bigint;
begin
  if actor is null or claims->>'role' is distinct from 'authenticated'
    or coalesce((claims->>'is_anonymous')::boolean, false)
    or not exists (select 1 from auth.users u join auth.sessions s on s.user_id = u.id
      where u.id = actor and u.is_anonymous is false and u.deleted_at is null and u.email_confirmed_at is not null
        and s.id::text = claims->>'session_id' and (s.not_after is null or s.not_after > clock_timestamp())) then
    raise exception 'live confirmed member session required' using errcode = '42501';
  end if;
  select max((a->>'timestamp')::bigint) into signed_in_at
  from jsonb_array_elements(case when jsonb_typeof(claims->'amr') = 'array' then claims->'amr' else '[]'::jsonb end) a
  where jsonb_typeof(a) = 'object' and a->>'method' is not null and a->>'method' <> 'anonymous'
    and a->>'timestamp' ~ '^[0-9]{1,12}$';
  if signed_in_at is null or signed_in_at < extract(epoch from clock_timestamp() - interval '15 minutes') then
    raise exception 'sign in again to close the account' using errcode = '42501', detail = 'recent_sign_in_required';
  end if;
  if exists (select 1 from private.staff_roles r where r.user_id = actor and r.revoked_at is null) then
    raise exception 'a staff account is closed only after its roles end' using errcode = '42501',
      detail = 'staff_account';
  end if;
  return actor;
end;
$function$;
alter function internal.account_closing_actor() owner to postgres;
revoke all on function internal.account_closing_actor() from public;

drop function internal.business_check_reread_open(timestamp with time zone);

alter table private.partners drop constraint partners_commission_bps_check;
alter table private.partners add constraint partners_commission_bps_check
  check (commission_bps is null or commission_bps between 0 and 5000);

do $$
begin
  if exists(
    select 1 from (values
      ('internal.save_my_communication_choices(text,boolean,boolean,boolean,boolean)','4d5daa0c4ec09f17833326c54dd77f14'),
      ('internal.staff_dashboard_overview()','ab15776eedf0a9d7316716ced5edd3d7'),
      ('internal.restored_staff_queues()','bcdaf1a5329c6d7c850ac13d65b9c907'),
      ('internal.search_posts(jsonb)','bb0f9748bc15c27d76495152bab2eb2a'),
      ('internal.staff_save_partner(uuid,text,text,integer,text)','f5d4ede86048226adb114a4d2080ca0d'),
      ('internal.get_frontend_enforcement()','133f494150ce9998900ea99e2e51435c'),
      ('internal.get_frontend_partner_admin()','ea9aa86cc1c731f513d67d175baae42c'),
      ('internal.staff_get_organisation(uuid)','ffe628db2b77015e74e140d92f1f48a1'),
      ('internal.get_frontend_staff_organisation_detail(uuid)','f11ffcd74661d45158c30ee4e780e8c3'),
      ('internal.get_frontend_cipc_case(uuid)','ed026d48191cac201053305cde485957'),
      ('internal.get_frontend_seen_case(uuid)','1275da13ade5358710b03902b00e7248'),
      ('internal.authorize_frontend_seen_file(uuid,boolean)','67feeb57c71f894b88f2fc89e133c2c6'),
      ('internal.account_closing_actor()','170006872f636cdda2a2bbc3e08a0a43')
    ) v(sig,body)
    where (select md5(replace(p.prosrc,E'\r\n',E'\n')) from pg_proc p where p.oid=to_regprocedure(v.sig)) is distinct from v.body)
    or to_regprocedure('internal.business_check_reread_open(timestamp with time zone)') is not null then
    raise exception 'privacy tightening 2 rollback was not completed';
  end if;
end$$;

notify pgrst,'reload schema';
commit;
