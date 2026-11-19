-- Post view counts and likes (roadmap P6).
--
-- Views and likes are counted per browser, through the website only: the
-- website gives each browser a random first-party identifier (cookie
-- vmz_viewer) and calls the two service commands below with it. The database
-- never stores that identifier, a network address or a user agent: it keeps
-- only keyed one-way hashes of it, and for views only for 48 hours.
--
-- 1. private.engagement_keys: one random 32-byte key, made here, for the like
--    hashes. No API role reads it.
-- 2. private.post_view_salts: one random 32-byte salt per day
--    (Africa/Johannesburg). The first view of a day makes the day's salt and
--    deletes every salt older than yesterday and every view mark older than 48
--    hours, so a mark cannot be linked to a browser after two days.
-- 3. private.post_view_marks: sha256(day salt || viewer || post) for each view
--    counted, with the time. Viewer is the browser, and the account when
--    signed in.
-- 4. private.post_view_days: the number of views of each post per day (the
--    only lasting view data; deleted with the post).
-- 5. private.post_likes: one row per like: the post, sha256(like key ||
--    browser), and the account when the like was made signed in (deleted with
--    the post, and with the Auth user when an account is erased).
--
-- Commands:
-- - api.record_post_views(p_post_ids uuid[], p_device uuid, p_account uuid)
--   (service only): 1 to 20 posts. Counts a post at most once per viewer in 24
--   hours (the browser's mark, and the account's when signed in, under
--   today's and yesterday's salt). Never counts a post that is not publicly
--   live, the owner's own view when signed in, or any view by an account with
--   an active staff role. Returns {"counted": [post ids]}.
-- - api.set_post_like(p_post_id uuid, p_device uuid, p_account uuid,
--   p_liked boolean) (service only): sets the browser's like on a publicly
--   live post to p_liked (null toggles) and returns {"liked", "likes",
--   "counted"}. One like per browser per post, and per account when signed in
--   (a like by the browser or the account counts as liked; unliking removes
--   both). The owner's own like (signed in) is never stored ("counted":
--   false). At most 600 new likes per post per hour (PT429 like_limit). An
--   unknown or hidden post is PT404 post_unavailable. An account that is not
--   active is treated as signed out, for views and likes alike.
-- - api.get_post_engagement(p_post_ids uuid[]) (anon and authenticated): for
--   up to 100 posts that are publicly listed, {"items": [{"post_id", "views",
--   "likes"}]}: totals only, never who.
--
-- The privacy export (internal.frontend_privacy_export_data) gains the
-- dataset post_likes: the posts the account liked while signed in, and when.
-- Likes made signed out cannot be tied to an account and are not exported.
--
-- Expand only: new tables and commands; the only existing function replaced is
-- the privacy export (one dataset added). The website calls the new commands
-- only while its switch SHOW_ENGAGEMENT_TOTALS is on, but the deploy preflight
-- probes every command in runtime-api-manifest.json.
--
-- ORDER: apply first, then merge (after 20261119082834_house_slots.sql in
-- filename order). Read-only preflight:
-- ../preflight/20261119151000_post_views_and_likes.check.sql.
-- Rollback: ../rollback/20261119151000_post_views_and_likes.down.sql.
begin;
-- Never wait more than 5 seconds for anything this update needs.
set local lock_timeout='5s';

-- Precondition: nothing of this update exists yet, or all of it does, and the
-- privacy export has its reviewed body (house slots) or this update's.
do $$
declare present integer; export_body text;
begin
  select (to_regclass('private.engagement_keys') is not null)::integer
    + (to_regclass('private.post_view_salts') is not null)::integer
    + (to_regclass('private.post_view_marks') is not null)::integer
    + (to_regclass('private.post_view_days') is not null)::integer
    + (to_regclass('private.post_likes') is not null)::integer
    + (to_regprocedure('internal.record_post_views(uuid[],uuid,uuid)') is not null)::integer
    + (to_regprocedure('api.record_post_views(uuid[],uuid,uuid)') is not null)::integer
    + (to_regprocedure('internal.set_post_like(uuid,uuid,uuid,boolean)') is not null)::integer
    + (to_regprocedure('api.set_post_like(uuid,uuid,uuid,boolean)') is not null)::integer
    + (to_regprocedure('internal.get_post_engagement(uuid[])') is not null)::integer
    + (to_regprocedure('api.get_post_engagement(uuid[])') is not null)::integer
  into present;
  if present not in (0, 11) then
    raise exception 'post views and likes precondition: % of 11 objects exist', present
      using errcode='55000';
  end if;
  select coalesce((select md5(replace(p.prosrc,E'\r\n',E'\n')) from pg_proc p
      where p.oid=to_regprocedure('internal.frontend_privacy_export_data(uuid)')),'absent')
    into export_body;
  if export_body not in ('e3842fd91a8d4f6b0bfe4cdc5b3030d9', 'a313d356df1fe2bc35166c19971c14c4') then
    raise exception 'post views and likes precondition: internal.frontend_privacy_export_data(uuid) % is not a reviewed body',
      export_body using errcode='55000';
  end if;
end$$;

create table if not exists private.engagement_keys (
  id smallint not null default 1,
  like_key bytea not null,
  created_at timestamptz not null default statement_timestamp(),
  constraint engagement_keys_pkey primary key (id),
  constraint engagement_keys_one_check check (id = 1),
  constraint engagement_keys_like_key_check check (octet_length(like_key) = 32)
);
alter table private.engagement_keys owner to postgres;
alter table private.engagement_keys enable row level security;
revoke all on private.engagement_keys from public, anon, authenticated, service_role;
-- 32 bytes from two random (version 4) UUIDs: 244 random bits.
insert into private.engagement_keys(id, like_key)
  values (1, decode(replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-',''),'hex'))
  on conflict (id) do nothing;

create table if not exists private.post_view_salts (
  day date not null,
  salt bytea not null,
  created_at timestamptz not null default statement_timestamp(),
  constraint post_view_salts_pkey primary key (day),
  constraint post_view_salts_salt_check check (octet_length(salt) = 32)
);
alter table private.post_view_salts owner to postgres;
alter table private.post_view_salts enable row level security;
revoke all on private.post_view_salts from public, anon, authenticated, service_role;

create table if not exists private.post_view_marks (
  mark bytea not null,
  seen_at timestamptz not null default statement_timestamp(),
  constraint post_view_marks_pkey primary key (mark),
  constraint post_view_marks_mark_check check (octet_length(mark) = 32)
);
alter table private.post_view_marks owner to postgres;
alter table private.post_view_marks enable row level security;
revoke all on private.post_view_marks from public, anon, authenticated, service_role;
create index if not exists post_view_marks_seen_at_idx on private.post_view_marks using btree (seen_at);

create table if not exists private.post_view_days (
  post_id uuid not null,
  day date not null,
  views integer not null,
  constraint post_view_days_pkey primary key (post_id, day),
  constraint post_view_days_post_id_fkey foreign key (post_id) references private.posts(id) on delete cascade,
  constraint post_view_days_views_check check (views > 0)
);
alter table private.post_view_days owner to postgres;
alter table private.post_view_days enable row level security;
revoke all on private.post_view_days from public, anon, authenticated, service_role;

create table if not exists private.post_likes (
  id uuid not null default gen_random_uuid(),
  post_id uuid not null,
  device_mark bytea not null,
  account_id uuid,
  created_at timestamptz not null default statement_timestamp(),
  constraint post_likes_pkey primary key (id),
  constraint post_likes_post_id_fkey foreign key (post_id) references private.posts(id) on delete cascade,
  constraint post_likes_account_id_fkey foreign key (account_id) references auth.users(id) on delete cascade,
  constraint post_likes_device_mark_check check (octet_length(device_mark) = 32)
);
alter table private.post_likes owner to postgres;
alter table private.post_likes enable row level security;
revoke all on private.post_likes from public, anon, authenticated, service_role;
create unique index if not exists post_likes_device_idx on private.post_likes using btree (post_id, device_mark);
create unique index if not exists post_likes_account_idx on private.post_likes using btree (post_id, account_id)
  where account_id is not null;
create index if not exists post_likes_post_created_idx on private.post_likes using btree (post_id, created_at);
create index if not exists post_likes_account_id_idx on private.post_likes using btree (account_id)
  where account_id is not null;

CREATE OR REPLACE FUNCTION internal.record_post_views(p_post_ids uuid[], p_device uuid, p_account uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  today date := (statement_timestamp() at time zone 'Africa/Johannesburg')::date;
  viewer uuid := p_account; salt_today bytea; salt_before bytea; pid uuid; post_owner uuid;
  bases text[]; primary_mark bytea; counted uuid[] := '{}'::uuid[];
begin
  if p_post_ids is null or p_device is null or cardinality(p_post_ids) not between 1 and 20
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
  -- The first view of the day makes its salt and forgets the older ones.
  insert into private.post_view_salts(day, salt)
    values (today, decode(replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-',''),'hex'))
    on conflict (day) do nothing;
  if found then
    delete from private.post_view_salts s where s.day < today - 1;
    delete from private.post_view_marks m where m.seen_at < statement_timestamp() - interval '48 hours';
  end if;
  select s.salt into salt_today from private.post_view_salts s where s.day = today;
  select s.salt into salt_before from private.post_view_salts s where s.day = today - 1;
  -- The account first when signed in: its mark decides whether the view counts.
  bases := case when viewer is null then array['device:'||p_device::text]
    else array['account:'||viewer::text, 'device:'||p_device::text] end;
  for pid in select distinct x from unnest(p_post_ids) x order by 1 loop
    select p.owner_id into post_owner from private.posts p
      join private.post_search_documents d on d.post_id = p.id
      where p.id = pid and d.is_visible and (d.visible_until is null or d.visible_until > statement_timestamp())
        and exists(select 1 from private.public_eligible_posts e where e.id = p.id);
    continue when not found or post_owner = viewer;
    -- Seen in the last 24 hours, under today's or yesterday's salt.
    continue when exists(select 1 from private.post_view_marks m
      where m.seen_at > statement_timestamp() - interval '24 hours'
        and m.mark in (select sha256(salt_today || convert_to(b || '|' || pid::text, 'UTF8')) from unnest(bases) b
          union all
          select sha256(salt_before || convert_to(b || '|' || pid::text, 'UTF8')) from unnest(bases) b
          where salt_before is not null));
    primary_mark := sha256(salt_today || convert_to(bases[1] || '|' || pid::text, 'UTF8'));
    insert into private.post_view_marks(mark) values (primary_mark) on conflict (mark) do nothing;
    -- A view sent twice at once counts once.
    continue when not found;
    insert into private.post_view_marks(mark)
      select sha256(salt_today || convert_to(b || '|' || pid::text, 'UTF8')) from unnest(bases[2:]) b
      on conflict (mark) do nothing;
    insert into private.post_view_days(post_id, day, views) values (pid, today, 1)
      on conflict (post_id, day) do update set views = private.post_view_days.views + 1;
    counted := counted || pid;
  end loop;
  return jsonb_build_object('counted', to_jsonb(counted));
end;
$function$;
alter function internal.record_post_views(uuid[],uuid,uuid) owner to postgres;
revoke all on function internal.record_post_views(uuid[],uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function internal.record_post_views(uuid[],uuid,uuid) to service_role;

CREATE OR REPLACE FUNCTION api.record_post_views(p_post_ids uuid[], p_device uuid, p_account uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.record_post_views(p_post_ids, p_device, p_account);
$function$;
alter function api.record_post_views(uuid[],uuid,uuid) owner to postgres;
revoke all on function api.record_post_views(uuid[],uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function api.record_post_views(uuid[],uuid,uuid) to service_role;

CREATE OR REPLACE FUNCTION internal.set_post_like(p_post_id uuid, p_device uuid, p_account uuid, p_liked boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare liker uuid := p_account; post_owner uuid; device bytea; is_liked boolean; wanted boolean; total bigint;
begin
  if p_post_id is null or p_device is null then
    raise exception 'like details are invalid' using errcode='22023', detail='like_invalid';
  end if;
  -- An account that is not active counts as signed out.
  if liker is not null and not exists(select 1 from private.current_account_access a where a.id=liker) then
    liker := null;
  end if;
  select p.owner_id into post_owner from private.posts p
    join private.post_search_documents d on d.post_id = p.id
    where p.id = p_post_id and d.is_visible and (d.visible_until is null or d.visible_until > statement_timestamp())
      and exists(select 1 from private.public_eligible_posts e where e.id = p.id);
  if not found then
    raise exception 'post unavailable' using errcode='PT404', detail='post_unavailable';
  end if;
  select sha256(k.like_key || convert_to('device|' || p_device::text, 'UTF8')) into device
    from private.engagement_keys k where k.id = 1;
  -- One change at a time per browser, then per account, on this post.
  perform pg_advisory_xact_lock(hashtextextended('post_like:' || p_post_id::text || ':' || encode(device, 'hex'), 0));
  if liker is not null then
    perform pg_advisory_xact_lock(hashtextextended('post_like:' || p_post_id::text || ':' || liker::text, 0));
  end if;
  is_liked := exists(select 1 from private.post_likes l where l.post_id = p_post_id
    and (l.device_mark = device or (liker is not null and l.account_id = liker)));
  wanted := coalesce(p_liked, not is_liked);
  if liker is not null and liker = post_owner then
    -- The owner's own like is never stored.
    select count(*) into total from private.post_likes l where l.post_id = p_post_id;
    return jsonb_build_object('liked', is_liked, 'likes', total, 'counted', false);
  end if;
  if wanted and not is_liked then
    if (select count(*) from private.post_likes l where l.post_id = p_post_id
        and l.created_at > statement_timestamp() - interval '1 hour') >= 600 then
      raise exception 'too many likes on this post; try again later' using errcode='PT429', detail='like_limit';
    end if;
    insert into private.post_likes(post_id, device_mark, account_id) values (p_post_id, device, liker)
      on conflict do nothing;
  elsif is_liked and not wanted then
    delete from private.post_likes l where l.post_id = p_post_id
      and (l.device_mark = device or (liker is not null and l.account_id = liker));
  end if;
  select count(*) into total from private.post_likes l where l.post_id = p_post_id;
  return jsonb_build_object('liked', wanted, 'likes', total, 'counted', true);
end;
$function$;
alter function internal.set_post_like(uuid,uuid,uuid,boolean) owner to postgres;
revoke all on function internal.set_post_like(uuid,uuid,uuid,boolean) from public, anon, authenticated, service_role;
grant execute on function internal.set_post_like(uuid,uuid,uuid,boolean) to service_role;

CREATE OR REPLACE FUNCTION api.set_post_like(p_post_id uuid, p_device uuid, p_account uuid DEFAULT NULL::uuid, p_liked boolean DEFAULT NULL::boolean)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.set_post_like(p_post_id, p_device, p_account, p_liked);
$function$;
alter function api.set_post_like(uuid,uuid,uuid,boolean) owner to postgres;
revoke all on function api.set_post_like(uuid,uuid,uuid,boolean) from public, anon, authenticated, service_role;
grant execute on function api.set_post_like(uuid,uuid,uuid,boolean) to service_role;

-- Public, like the post cards: totals only, never who.
CREATE OR REPLACE FUNCTION internal.get_post_engagement(p_post_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if p_post_ids is null or cardinality(p_post_ids) > 100 or array_position(p_post_ids, null) is not null then
    raise exception 'engagement request is invalid' using errcode='22023', detail='engagement_invalid';
  end if;
  return jsonb_build_object('items', coalesce((
    select jsonb_agg(jsonb_build_object('post_id', d.post_id,
        'views', coalesce((select sum(v.views) from private.post_view_days v where v.post_id = d.post_id), 0),
        'likes', (select count(*) from private.post_likes l where l.post_id = d.post_id))
      order by d.post_id)
    from private.post_search_documents d
    where d.post_id = any(p_post_ids) and d.is_visible
      and (d.visible_until is null or d.visible_until > statement_timestamp())), '[]'::jsonb));
end;
$function$;
alter function internal.get_post_engagement(uuid[]) owner to postgres;
revoke all on function internal.get_post_engagement(uuid[]) from public, anon, authenticated, service_role;
grant execute on function internal.get_post_engagement(uuid[]) to anon;
grant execute on function internal.get_post_engagement(uuid[]) to authenticated;

CREATE OR REPLACE FUNCTION api.get_post_engagement(p_post_ids uuid[])
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.get_post_engagement(p_post_ids);
$function$;
alter function api.get_post_engagement(uuid[]) owner to postgres;
revoke all on function api.get_post_engagement(uuid[]) from public, anon, authenticated, service_role;
grant execute on function api.get_post_engagement(uuid[]) to anon;
grant execute on function api.get_post_engagement(uuid[]) to authenticated;

-- The privacy export: the dataset post_likes added before notifications.
CREATE OR REPLACE FUNCTION internal.frontend_privacy_export_data(p_subject uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
declare entry record;items jsonb;row_count integer;result jsonb:='{}';size_so_far bigint:=0;
begin
  for entry in select * from (values
    ('profile',$q$select account_id,display_name,bio,legal_first_name,legal_last_name,legal_name_locked_at,created_at,updated_at from private.profiles where account_id=$1$q$),
    ('account',$q$select id,email,email_confirmed_at,phone,phone_confirmed_at,created_at,last_sign_in_at from auth.users where id=$1 and deleted_at is null$q$),
    ('listing_drafts',$q$select category_key,price_mode,price_cents,price_negotiable,revision,expires_at from private.listing_price_drafts where owner_id=$1$q$),
    ('posts',$q$select p.id,p.kind,p.area,p.category_key,p.activity_key,p.title,p.description,p.province_id,p.city_id,p.locality_label,
      p.status,p.status_reason,p.created_at,p.submitted_at,p.published_at,p.visible_until,p.edit_of,
      l.price_mode,l.price_cents,l.price_negotiable,l.attributes,b.business_type,e.starts_at,e.ends_at,e.timezone,
      s.slug,d.data presentation,d.contacts contact_details,c.channels
      from private.posts p left join private.listing_details l on l.post_id=p.id left join private.business_details b on b.post_id=p.id
      left join private.event_details e on e.post_id=p.id left join private.post_slugs s on s.post_id=p.id
      left join private.post_presentations d on d.post_id=p.id left join private.post_contacts c on c.post_id=p.id
      where p.owner_id=$1 order by p.created_at,p.id$q$),
    ('post_reviews',$q$select m.post_id,m.edit_id,m.decision,m.reason,m.decided_at,m.price_only
      from private.moderation_log m join private.posts p on p.id=m.post_id where p.owner_id=$1 order by m.decided_at,m.id$q$),
    ('media_metadata',$q$select id,kind,size_bytes,mime,width,height,state,created_at,deleted_at from private.media_objects where owner_id=$1 order by created_at,id$q$),
    ('payments',$q$select p.id,p.product_kind,p.target_post_id,p.amount_cents,p.currency,p.status,p.fulfillment_status,p.merchant_reference,
      p.provider,p.created_at,p.completed_at,coalesce((p.snapshot->>'renewal')::boolean,false) renewal,
      p.snapshot->'cooling_off_consent' cooling_off_consent,p.snapshot->'renewal_starts' renewal_starts,
      (select jsonb_agg(jsonb_build_object('line_number',l.line_number,'amount_cents',l.amount_cents,'status',l.status,
          'renews_entitlement_id',l.renews_entitlement_id,'slot_count',l.slot_count,'reversal_kind',l.reversal_kind,
          'reversed_at',l.reversed_at)
        order by l.line_number) from private.payment_lines l where l.payment_id=p.id) lines
      from private.payments p where p.owner_id=$1 order by p.created_at,p.id$q$),
    ('invoices',$q$select i.id,i.payment_id,i.invoice_number,i.amount_ex_vat_cents,i.vat_cents,i.total_cents,i.description,i.issued_at
      from private.invoices i join private.payments p on p.id=i.payment_id where p.owner_id=$1 order by i.issued_at,i.id$q$),
    ('customer_invoices',$q$select i.invoice_number,i.status,i.description,i.slots,i.unit_price_cents,i.total_cents,i.issued_at,i.due_on,
      i.buyer_name,i.buyer_address,i.buyer_registration_number,i.buyer_saved_at,i.cooling_off_consent_at,i.cooling_off_consent_version,
      i.payment_id,i.paid_at,i.voided_at,(select array_agg(l.payment_id order by l.attempt) from private.customer_invoice_payments l
        where l.invoice_id=i.id) payment_attempts
      from private.customer_invoices i where i.account_id=$1 order by i.issued_at,i.id$q$),
    ('bank_transfers',$q$select t.id,t.payment_id,v.duration_days term_days,t.slots,t.amount_received_cents,t.bank_reference,t.cleared_on,
      t.cooling_off_waiver_confirmed,t.status,t.recorded_at,t.confirmed_at,t.declined_at,t.expired_at
      from private.invoice_transfers t join private.plan_versions v on v.id=t.plan_version_id where t.account_id=$1 order by t.recorded_at,t.id$q$),
    ('entitlements',$q$select id,source,area,slot_capacity,activations_per_period,activation_period_days,max_photos,max_videos,starts_at,ends_at,status,revoked_reason,
      renews_entitlement_id,slot_id,package_id
      from private.entitlements where owner_id=$1 order by created_at,id$q$),
    ('house_slot_events',$q$select h.entitlement_id,h.action,h.ends_at,h.recorded_at from private.house_slot_events h
      join private.entitlements e on e.id=h.entitlement_id where e.owner_id=$1 order by h.recorded_at,h.id$q$),
    ('slot_packages',$q$select id,term_days,slot_count,created_at from private.slot_packages where owner_id=$1
      order by created_at,id$q$),
    ('package_invoice_requests',$q$select r.id,r.term_days,r.slots,r.unit_price_cents,r.total_cents,r.requested_at,r.consent_at,
      r.consent_version,r.status,r.closed_at,(select i.invoice_number from private.customer_invoices i where i.id=r.invoice_id) invoice_number
      from private.package_invoice_requests r where r.account_id=$1 order by r.requested_at,r.id$q$),
    ('post_activations',$q$select post_id,entitlement_id,activated_at,released_at,release_reason,continued
      from private.post_activations where owner_id=$1 order by activated_at,id$q$),
    ('event_submissions',$q$select post_id,submitted_at,released_at,release_reason
      from private.event_submissions where owner_id=$1 order by submitted_at,id$q$),
    ('introductory_trials',$q$select post_id,trial_entitlement_id,claimed_at,converted_at
      from private.post_trial_claims where owner_id=$1 order by claimed_at,post_id$q$),
    ('posting_terms',$q$select version,document_hash,accepted_at from private.posting_terms_acceptances where owner_id=$1 order by accepted_at,version$q$),
    ('signup_terms',$q$select version,document_hash,method,accepted_at from private.signup_terms_acceptances where account_id=$1$q$),
    ('communication_choices',$q$select purpose,granted,wording_version,recorded_at from private.communication_choice_events
      where account_id=$1 order by recorded_at,id$q$),
    ('verification_cases',$q$select id,kind,status,created_at from private.evidence_cases where subject_id=$1 order by created_at,id$q$),
    ('verification_reviews',$q$select r.case_id,r.reason,r.decision,r.created_at from private.verification_return_requests r join private.evidence_cases c on c.id=r.case_id
      where c.subject_id=$1 order by r.created_at,r.id$q$),
    ('evidence_metadata',$q$select id,case_id,purpose,state,size_bytes,created_at,retain_until,deleted_at
      from private.evidence_artifacts where owner_id=$1 order by created_at,id$q$),
    ('phone_verification',$q$select phone,verified_at,contact_changed_at,revoked_at from private.verification_phone_proofs where owner_id=$1 order by verified_at,id$q$),
    ('locality_verification',$q$select province_id,city_id,assurance,confirmed_at from private.verification_localities where owner_id=$1$q$),
    ('enquiries_sent',$q$select id,post_id,message,created_at from private.enquiries where sender_account_id=$1 order by created_at,id$q$),
    ('enquiries_received',$q$select id,post_id,message,status,created_at from private.enquiries where owner_id=$1 order by created_at,id$q$),
    ('post_likes',$q$select post_id,created_at from private.post_likes where account_id=$1 order by created_at,id$q$),
    ('notifications',$q$select id,kind,post_id,created_at,read_at from private.notifications where account_id=$1 order by created_at,id$q$),
    ('reports_submitted',$q$select id,post_id,coalesce(frontend_reason,category) category,description,status,created_at,resolved_at
      from private.reports where reporter_id=$1 order by created_at,id$q$),
    ('moderation_decisions',$q$select id,kind,reason,starts_at,ends_at,active from private.frontend_appealable_actions
      where account_id=$1 order by starts_at,id$q$),
    ('appeals',$q$select id,action_id,kind,reason,status,reviewer_rationale,created_at,resolved_at from private.frontend_appeals
      where appellant_id=$1 order by created_at,id$q$),
    ('organisation_applications',$q$select id,organisation_id,programme_id,post_id,reason,member_reference,share_representative_name,consented_at,
      status,info_request,info_response,decision_at,decision_note,created_at from private.organisation_applications where applicant_id=$1 order by created_at,id$q$),
    ('organisation_affiliations',$q$select a.id,a.organisation_id,a.programme_id,a.post_id,a.affiliation_type,a.status,a.confirmed_at,a.revoked_at,a.revoke_reason
      from private.organisation_affiliations a join private.posts p on p.id=a.post_id where p.owner_id=$1 order by a.created_at,a.id$q$),
    ('organisation_roles',$q$select organisation_id,role,created_at from private.organisation_admins where account_id=$1 order by created_at,organisation_id$q$),
    ('sponsorships',$q$select id,organisation_id,post_id,sponsor_type,status,starts_at,ends_at,ended_at,end_reason
      from private.organisation_sponsorships where owner_id=$1 order by created_at,id$q$),
    ('partner_account',$q$select id,code,status,commission_bps,created_at,updated_at from private.partners where account_id=$1 order by created_at,id$q$),
    ('partner_commissions',$q$select c.id,c.base_cents,c.rate_bps,c.amount_cents,c.status,c.eligible_at,c.approved_at,c.paid_at,c.reversed_at
      from private.partner_commissions c join private.partners p on p.id=c.partner_id where p.account_id=$1 order by c.created_at,c.id$q$),
    ('acquisition',$q$select source,campaign,landing_path,referrer_host,first_touch_at,recorded_at from private.account_acquisitions where account_id=$1$q$),
    ('account_closure',$q$select closed_at,evidence_delete_after from private.account_closures where user_id=$1$q$),
    ('data_requests',$q$select id,type,description,status,received_at,due_by,extended_due_at,extension_reason,response_summary,completed_at
      from private.privacy_requests where subject_user_id=$1 order by received_at,id$q$)
  ) as registry(dataset,statement) loop
    execute 'select coalesce(jsonb_agg(to_jsonb(x)),''[]''::jsonb),count(*) from ('||entry.statement||' limit 2501)x'
      into items,row_count using p_subject;
    size_so_far:=size_so_far+octet_length(items::text);
    if row_count>2500 or size_so_far>4194304 then raise exception 'privacy export exceeds the direct delivery limit' using errcode='PT413';end if;
    result:=result||jsonb_build_object(entry.dataset,items);
  end loop;
  return result;
end$function$;
alter function internal.frontend_privacy_export_data(uuid) owner to postgres;
revoke all on function internal.frontend_privacy_export_data(uuid) from public;

notify pgrst,'reload schema';
commit;
