-- Post view counts and likes (roadmap P6).
--
-- The website gives each browser a random identifier in a first-party cookie
-- (vmz_viewer), signed by the website and issued only after a Turnstile check,
-- so a made-up identifier is never counted, and passes it, with the
-- GoTrue-verified account or none, to the two service commands below. The
-- database never stores that identifier, a network address or a user agent.
-- Abuse is limited per source on the website (per IPv4 address or IPv6 /48,
-- per post, per cookie). The two site-wide safety valves here only protect
-- storage and never switch a feature off for everyone: over a valve, viewers
-- and likers that are established (a browser identifier older than 24 hours,
-- or a signed-in account older than 7 days) keep counting; only new ones stop.
-- Staff get a cost alarm at 70% of a valve (warning) and at the valve
-- (critical).
--
-- Tables (row level security on; no API role has table access):
-- 1. private.engagement_keys: one random 32-byte key, made here, for like
--    hashes.
-- 2. private.post_view_salts: one random 32-byte salt per day
--    (Africa/Johannesburg), with the day's counted views and net new likes.
-- 3. private.post_view_marks: sha256(day salt || browser || post) and the
--    time, one per counted view. Never an account. The daily retention job
--    (api.run_retention) deletes marks older than 24 hours and salts older
--    than yesterday, so a mark is gone within 2 days and a salt within 3.
-- 4. private.post_view_days: views per post per day (the only lasting view
--    data; deleted with the post).
-- 5. private.post_engagement_totals: one row per post with its total views
--    and counted likes (kept by triggers on private.post_likes); the public
--    read and the like command read this row, and it is the lock for changes
--    to the post's likes.
-- 6. private.post_likes: one row per like: either sha256(like key || browser)
--    for a like made signed out, or the account for a like made signed in,
--    never both, and when it starts to count. Deleted with the post; a
--    signed-in like also with the account (account erasure deletes it, and
--    the Auth user's deletion cascades).
--
-- Commands:
-- - api.record_post_views(p_post_ids uuid[], p_device uuid, p_account uuid,
--   p_device_issued_at timestamptz) (service only): 1 to 5 posts (22023
--   views_invalid), counted in id order. A post counts at most once per
--   browser in 24 hours (today's or yesterday's salt), never when it is not
--   publicly live, never the signed-in owner's own view, never any view by an
--   account with an active staff role (an inactive account counts as signed
--   out). No per-post cap. Safety valve: over 300,000 counted views in a day,
--   only established viewers are counted (others store nothing). Returns
--   {"counted": [post ids]}.
-- - api.set_post_like(p_post_id uuid, p_device uuid, p_account uuid,
--   p_liked boolean, p_device_issued_at timestamptz) (service only): sets
--   (null toggles) the like of the signed-in account, or of the browser when
--   signed out, on a publicly live post (PT404 post_unavailable otherwise;
--   22023 like_invalid). Signed in it acts only on the account's like, signed
--   out only on the browser's. The owner's and staff's own likes are never
--   stored ("counted": false); they may remove the like their browser made
--   while signed out. A signed-out like from a browser identifier issued less
--   than 10 minutes earlier is stored but counts only from then. No per-post
--   cap. Safety valve: over 50,000 net new likes in a day (a like taken back
--   the same day gives its place back), only established likers' likes are
--   stored; others answer "liked": false, "counted": false. Returns
--   {"liked", "likes", "counted"}; likes is the post's counted total plus
--   the caller's own like while it waits.
-- - api.get_post_engagement(p_post_ids uuid[]) (anon and authenticated): up
--   to 50 ids (22023 engagement_invalid); for each publicly live post
--   {"post_id", "views", "likes"}; a hidden or unknown post is simply absent.
-- - internal.engagement_established and internal.engagement_valve_alarms:
--   the helpers of the valves (no API role).
--
-- Replaced functions (full bodies; each checked against its reviewed body):
-- - internal.frontend_privacy_export_data: datasets post_likes (the latest
--   2,000 likes made signed in) and post_likes_summary (their number, first
--   and last), so the export never fails because of likes.
-- - internal.run_retention: also runs internal.purge_post_engagement
--   ("engagement": salts and marks deleted, waiting likes that are due
--   counted, in batches).
-- - internal.erase_closed_account: also deletes the account's likes.
--
-- Two cost allowances (measurement 'estimate', not checked by
-- check_cost_alarms) name the two safety valves for the staff cost page.
--
-- Known limits: a view or like by the owner (or staff) while signed out cannot
-- be told apart from anyone else's; one person can have one like signed out
-- per browser and one per account on the same post.
--
-- ORDER: apply first, then merge. Read-only preflight:
-- ../preflight/20261119172135_post_views_and_likes.check.sql.
-- Rollback: ../rollback/20261119172135_post_views_and_likes.down.sql.
begin;
-- Never wait more than 5 seconds for anything this update needs.
set local lock_timeout='5s';

-- Precondition: nothing of this update exists yet, or all of it does, and the
-- three functions it replaces have their reviewed bodies (or this update's).
do $$
declare present integer; shape text;
begin
  select (to_regclass('private.engagement_keys') is not null)::integer
    + (to_regclass('private.post_view_salts') is not null)::integer
    + (to_regclass('private.post_view_marks') is not null)::integer
    + (to_regclass('private.post_view_days') is not null)::integer
    + (to_regclass('private.post_engagement_totals') is not null)::integer
    + (to_regclass('private.post_likes') is not null)::integer
    + (to_regprocedure('internal.record_post_views(uuid[],uuid,uuid,timestamptz)') is not null)::integer
    + (to_regprocedure('api.record_post_views(uuid[],uuid,uuid,timestamptz)') is not null)::integer
    + (to_regprocedure('internal.set_post_like(uuid,uuid,uuid,boolean,timestamptz)') is not null)::integer
    + (to_regprocedure('api.set_post_like(uuid,uuid,uuid,boolean,timestamptz)') is not null)::integer
    + (to_regprocedure('internal.get_post_engagement(uuid[])') is not null)::integer
    + (to_regprocedure('api.get_post_engagement(uuid[])') is not null)::integer
    + (to_regprocedure('internal.purge_post_engagement()') is not null)::integer
    + (to_regprocedure('internal.post_likes_count()') is not null)::integer
    + (to_regprocedure('internal.engagement_established(uuid,timestamptz)') is not null)::integer
    + (to_regprocedure('internal.engagement_valve_alarms(text,integer,integer,integer)') is not null)::integer
  into present;
  if present not in (0, 16) then
    raise exception 'post views and likes precondition: % of 16 objects exist', present
      using errcode='55000';
  end if;
  for shape in
    select v.sig||' '||coalesce((select md5(replace(p.prosrc,E'\r\n',E'\n')) from pg_proc p
        where p.oid=to_regprocedure(v.sig)),'absent')
    from (values ('internal.frontend_privacy_export_data(uuid)'), ('internal.run_retention(integer)'),
      ('internal.erase_closed_account(uuid,text)')) v(sig)
  loop
    if shape not in (
        'internal.frontend_privacy_export_data(uuid) e3842fd91a8d4f6b0bfe4cdc5b3030d9',
        'internal.frontend_privacy_export_data(uuid) 3dfe35ae5e93f0661ecd7dbf710cf45d',
        'internal.run_retention(integer) 3fc3981961fda5c149c6540e03a5b4c3',
        'internal.run_retention(integer) 06a3fbfcb5b2d53e2487719174a62cc5',
        'internal.erase_closed_account(uuid,text) 0110024c386259da47b96caf79555bac',
        'internal.erase_closed_account(uuid,text) c1352cec14d02d401b58e466c387d747') then
      raise exception 'post views and likes precondition: % is not a reviewed body', shape
        using errcode='55000';
    end if;
  end loop;
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
  views integer not null default 0,
  likes integer not null default 0,
  created_at timestamptz not null default statement_timestamp(),
  constraint post_view_salts_pkey primary key (day),
  constraint post_view_salts_salt_check check (octet_length(salt) = 32),
  constraint post_view_salts_counts_check check (views >= 0 and likes >= 0)
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
  constraint post_view_days_views_check check (views >= 1)
);
alter table private.post_view_days owner to postgres;
alter table private.post_view_days enable row level security;
revoke all on private.post_view_days from public, anon, authenticated, service_role;

create table if not exists private.post_engagement_totals (
  post_id uuid not null,
  views bigint not null default 0,
  likes integer not null default 0,
  constraint post_engagement_totals_pkey primary key (post_id),
  constraint post_engagement_totals_post_id_fkey foreign key (post_id) references private.posts(id) on delete cascade,
  constraint post_engagement_totals_counts_check check (views >= 0 and likes >= 0)
);
alter table private.post_engagement_totals owner to postgres;
alter table private.post_engagement_totals enable row level security;
revoke all on private.post_engagement_totals from public, anon, authenticated, service_role;

create table if not exists private.post_likes (
  id uuid not null default gen_random_uuid(),
  post_id uuid not null,
  device_mark bytea,
  account_id uuid,
  counts_from timestamptz not null default statement_timestamp(),
  waiting boolean not null default false,
  created_at timestamptz not null default statement_timestamp(),
  constraint post_likes_pkey primary key (id),
  constraint post_likes_post_id_fkey foreign key (post_id) references private.posts(id) on delete cascade,
  constraint post_likes_account_id_fkey foreign key (account_id) references auth.users(id) on delete cascade,
  constraint post_likes_one_liker_check check (num_nonnulls(device_mark, account_id) = 1),
  constraint post_likes_device_mark_check check (device_mark is null or octet_length(device_mark) = 32)
);
alter table private.post_likes owner to postgres;
alter table private.post_likes enable row level security;
revoke all on private.post_likes from public, anon, authenticated, service_role;
create unique index if not exists post_likes_device_idx on private.post_likes using btree (post_id, device_mark)
  where device_mark is not null;
create unique index if not exists post_likes_account_idx on private.post_likes using btree (post_id, account_id)
  where account_id is not null;
create index if not exists post_likes_post_id_idx on private.post_likes using btree (post_id);
create index if not exists post_likes_account_id_idx on private.post_likes using btree (account_id)
  where account_id is not null;
create index if not exists post_likes_waiting_idx on private.post_likes using btree (counts_from)
  where waiting;

-- The safety valves, named for the staff cost page (an estimate: never
-- checked by internal.check_cost_alarms; the commands raise their alarms).
insert into private.cost_allowances (metric, label, unit, free_quantity, period, provider, overage_note,
    measured_in_database, measurement)
  values
    ('post_views_counted', 'Post views counted today (storage safety limit)', 'count', 300000, 'day',
      'Supabase database', 'Above it no more views are counted that day, to protect database storage', true, 'estimate'),
    ('post_likes_new', 'New likes today (storage safety limit)', 'count', 50000, 'day',
      'Supabase database', 'Above it new likes are refused that day, to protect database storage', true, 'estimate')
  on conflict (metric) do nothing;

-- The like total of a post counts its like rows that are not waiting,
-- whatever adds, removes or releases them (the like command, the views and
-- retention jobs releasing waiting likes, account erasure, the Auth user's
-- deletion).
CREATE OR REPLACE FUNCTION internal.post_likes_count()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if tg_op = 'INSERT' then
    if not new.waiting then
      insert into private.post_engagement_totals as t (post_id, likes) values (new.post_id, 1)
        on conflict (post_id) do update set likes = t.likes + 1;
    end if;
    return new;
  elsif tg_op = 'UPDATE' then
    if old.waiting and not new.waiting then
      insert into private.post_engagement_totals as t (post_id, likes) values (new.post_id, 1)
        on conflict (post_id) do update set likes = t.likes + 1;
    end if;
    return new;
  end if;
  if not old.waiting then
    update private.post_engagement_totals t set likes = greatest(t.likes - 1, 0) where t.post_id = old.post_id;
  end if;
  return old;
end;
$function$;
alter function internal.post_likes_count() owner to postgres;
revoke all on function internal.post_likes_count() from public, anon, authenticated, service_role;
drop trigger if exists post_likes_count on private.post_likes;
create trigger post_likes_count after insert or delete or update of waiting on private.post_likes
  for each row execute function internal.post_likes_count();

-- Whether a viewer or liker is established: a signed-in account (active)
-- created more than 7 days ago, or a browser identifier issued more than 24
-- hours ago. Over a safety valve only established viewers and likers keep
-- counting, so a flood of new identifiers never switches counting off for
-- everyone.
CREATE OR REPLACE FUNCTION internal.engagement_established(p_account uuid, p_device_issued_at timestamptz)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
  select coalesce(p_device_issued_at < statement_timestamp() - interval '24 hours', false)
    or (p_account is not null and exists(select 1 from auth.users u
      join private.current_account_access a on a.id = u.id
      where u.id = p_account and u.created_at < statement_timestamp() - interval '7 days'));
$function$;
alter function internal.engagement_established(uuid,timestamptz) owner to postgres;
revoke all on function internal.engagement_established(uuid,timestamptz) from public, anon, authenticated, service_role;

-- Staff cost alarms of a safety valve when the day's count crosses 70% of it
-- (warning) and the valve itself (critical); each at most once a day.
CREATE OR REPLACE FUNCTION internal.engagement_valve_alarms(p_metric text, p_valve integer, p_before integer, p_after integer)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
  insert into private.cost_alarms (metric, level, period, used, free_quantity)
  select p_metric, l.level, to_char((statement_timestamp() at time zone 'Africa/Johannesburg')::date, 'YYYY-MM-DD'),
    p_after, p_valve
  from (values ('warning', p_valve * 7 / 10), ('critical', p_valve)) l(level, threshold)
  where p_before < l.threshold and p_after >= l.threshold
  on conflict (metric, level, period) do nothing;
$function$;
alter function internal.engagement_valve_alarms(text,integer,integer,integer) owner to postgres;
revoke all on function internal.engagement_valve_alarms(text,integer,integer,integer) from public, anon, authenticated, service_role;

-- Lock order (no deadlock): a post's days row, then its totals row, then its
-- like rows, posts in id order; the day's salt row last of all.
CREATE OR REPLACE FUNCTION internal.record_post_views(p_post_ids uuid[], p_device uuid, p_account uuid, p_device_issued_at timestamptz)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  today date := (statement_timestamp() at time zone 'Africa/Johannesburg')::date;
  viewer uuid := p_account; salt_today bytea; salt_before bytea; pid uuid; post_owner uuid;
  new_mark bytea; counted uuid[] := '{}'::uuid[]; day_views integer; after_views integer;
begin
  if p_post_ids is null or p_device is null or cardinality(p_post_ids) not between 1 and 5
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
  -- The day's salt. The retention job deletes old salts and marks; this only
  -- keeps at most two salts if that job has not run.
  insert into private.post_view_salts(day, salt)
    values (today, decode(replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-',''),'hex'))
    on conflict (day) do nothing;
  if found then
    delete from private.post_view_salts s where s.day < today - 1;
  end if;
  select s.salt, s.views into salt_today, day_views from private.post_view_salts s where s.day = today;
  select s.salt into salt_before from private.post_view_salts s where s.day = today - 1;
  -- Storage safety valve for the whole site: over 300,000 counted views in a
  -- day only established viewers keep counting (and storing marks).
  if day_views >= 300000 and not internal.engagement_established(viewer, p_device_issued_at) then
    return jsonb_build_object('counted', '[]'::jsonb);
  end if;
  for pid in select distinct x from unnest(p_post_ids) x order by 1 loop
    select p.owner_id into post_owner from private.posts p
      join private.post_search_documents d on d.post_id = p.id
      where p.id = pid and d.is_visible and (d.visible_until is null or d.visible_until > statement_timestamp())
        and exists(select 1 from private.public_eligible_posts e where e.id = p.id);
    continue when not found or post_owner = viewer;
    -- Seen by this browser in the last 24 hours, under today's or yesterday's salt.
    continue when exists(select 1 from private.post_view_marks m
      where m.seen_at > statement_timestamp() - interval '24 hours'
        and m.mark in (sha256(salt_today || convert_to('device:' || p_device::text || '|' || pid::text, 'UTF8')),
          sha256(coalesce(salt_before, salt_today) || convert_to('device:' || p_device::text || '|' || pid::text, 'UTF8'))));
    new_mark := sha256(salt_today || convert_to('device:' || p_device::text || '|' || pid::text, 'UTF8'));
    insert into private.post_view_marks(mark) values (new_mark) on conflict (mark) do nothing;
    -- A view sent twice at once counts once.
    continue when not found;
    insert into private.post_view_days as d (post_id, day, views) values (pid, today, 1)
      on conflict (post_id, day) do update set views = d.views + 1;
    insert into private.post_engagement_totals as t (post_id, views) values (pid, 1)
      on conflict (post_id) do update set views = t.views + 1;
    -- Likes of this post that were waiting and are due now start to count.
    update private.post_likes l set waiting = false
      where l.post_id = pid and l.waiting and l.counts_from <= statement_timestamp();
    counted := counted || pid;
  end loop;
  -- The day's count, once per request and last.
  if cardinality(counted) > 0 then
    update private.post_view_salts s set views = s.views + cardinality(counted) where s.day = today
      returning s.views into after_views;
    perform internal.engagement_valve_alarms('post_views_counted', 300000,
      after_views - cardinality(counted), after_views);
  end if;
  return jsonb_build_object('counted', to_jsonb(counted));
end;
$function$;
alter function internal.record_post_views(uuid[],uuid,uuid,timestamptz) owner to postgres;
revoke all on function internal.record_post_views(uuid[],uuid,uuid,timestamptz) from public, anon, authenticated, service_role;
grant execute on function internal.record_post_views(uuid[],uuid,uuid,timestamptz) to service_role;

CREATE OR REPLACE FUNCTION api.record_post_views(p_post_ids uuid[], p_device uuid, p_account uuid DEFAULT NULL::uuid, p_device_issued_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.record_post_views(p_post_ids, p_device, p_account, p_device_issued_at);
$function$;
alter function api.record_post_views(uuid[],uuid,uuid,timestamptz) owner to postgres;
revoke all on function api.record_post_views(uuid[],uuid,uuid,timestamptz) from public, anon, authenticated, service_role;
grant execute on function api.record_post_views(uuid[],uuid,uuid,timestamptz) to service_role;

CREATE OR REPLACE FUNCTION internal.set_post_like(p_post_id uuid, p_device uuid, p_account uuid, p_liked boolean, p_device_issued_at timestamptz)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  liker uuid := p_account; post_owner uuid; device bytea; mine private.post_likes; wanted boolean;
  today date := (statement_timestamp() at time zone 'Africa/Johannesburg')::date;
  starts timestamptz := statement_timestamp(); day_likes integer;
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
  -- One change at a time per post: its totals row is the lock.
  insert into private.post_engagement_totals(post_id) values (p_post_id) on conflict (post_id) do nothing;
  perform 1 from private.post_engagement_totals t where t.post_id = p_post_id for update;
  -- Likes of this post that were waiting and are due now start to count.
  update private.post_likes l set waiting = false
    where l.post_id = p_post_id and l.waiting and l.counts_from <= statement_timestamp();
  if liker is not null and (liker = post_owner
      or exists(select 1 from private.staff_roles r where r.user_id=liker and r.revoked_at is null)) then
    -- The owner's and staff's own likes are never stored; they may remove the
    -- like their browser made while signed out.
    if p_liked is not true then
      delete from private.post_likes l where l.post_id = p_post_id and l.device_mark = device;
    end if;
    return jsonb_build_object('liked', false, 'counted', false, 'likes',
      (select t.likes from private.post_engagement_totals t where t.post_id = p_post_id));
  end if;
  -- Signed in: only the account's like; signed out: only this browser's.
  if liker is not null then
    select l.* into mine from private.post_likes l where l.post_id = p_post_id and l.account_id = liker;
  else
    select l.* into mine from private.post_likes l where l.post_id = p_post_id and l.device_mark = device;
  end if;
  wanted := coalesce(p_liked, mine.id is null);
  if wanted and mine.id is null then
    -- Storage safety valve for the whole site.
    insert into private.post_view_salts(day, salt)
      values (today, decode(replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-',''),'hex'))
      on conflict (day) do nothing;
    select s.likes into day_likes from private.post_view_salts s where s.day = today;
    -- Storage safety valve: over 50,000 net new likes in a day only
    -- established likers' likes are stored (not an error: that would undo
    -- the alarm).
    if day_likes >= 50000 and not internal.engagement_established(liker, p_device_issued_at) then
      return jsonb_build_object('liked', false, 'counted', false, 'likes',
        (select t.likes from private.post_engagement_totals t where t.post_id = p_post_id));
    end if;
    -- A browser identifier issued in the last 10 minutes: its like waits.
    if liker is null and p_device_issued_at is not null then
      starts := greatest(starts, p_device_issued_at + interval '10 minutes');
    end if;
    insert into private.post_likes(post_id, device_mark, account_id, counts_from, waiting)
      values (p_post_id, case when liker is null then device end, liker, starts, starts > statement_timestamp());
    update private.post_view_salts s set likes = s.likes + 1 where s.day = today
      returning s.likes into day_likes;
    perform internal.engagement_valve_alarms('post_likes_new', 50000, day_likes - 1, day_likes);
  elsif mine.id is not null and not wanted then
    delete from private.post_likes l where l.id = mine.id;
    -- The day's count is net: a like made today and taken back gives its place back.
    if (mine.created_at at time zone 'Africa/Johannesburg')::date = today then
      update private.post_view_salts s set likes = greatest(s.likes - 1, 0) where s.day = today;
    end if;
  end if;
  return jsonb_build_object('liked', wanted, 'counted', true, 'likes',
    (select t.likes from private.post_engagement_totals t where t.post_id = p_post_id)
      + case when wanted and exists(select 1 from private.post_likes l where l.post_id = p_post_id and l.waiting
          and (l.account_id = liker or (liker is null and l.device_mark = device))) then 1 else 0 end);
end;
$function$;
alter function internal.set_post_like(uuid,uuid,uuid,boolean,timestamptz) owner to postgres;
revoke all on function internal.set_post_like(uuid,uuid,uuid,boolean,timestamptz) from public, anon, authenticated, service_role;
grant execute on function internal.set_post_like(uuid,uuid,uuid,boolean,timestamptz) to service_role;

CREATE OR REPLACE FUNCTION api.set_post_like(p_post_id uuid, p_device uuid, p_account uuid DEFAULT NULL::uuid, p_liked boolean DEFAULT NULL::boolean, p_device_issued_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.set_post_like(p_post_id, p_device, p_account, p_liked, p_device_issued_at);
$function$;
alter function api.set_post_like(uuid,uuid,uuid,boolean,timestamptz) owner to postgres;
revoke all on function api.set_post_like(uuid,uuid,uuid,boolean,timestamptz) from public, anon, authenticated, service_role;
grant execute on function api.set_post_like(uuid,uuid,uuid,boolean,timestamptz) to service_role;

-- Public, like the post cards: totals only, never who; only for publicly live
-- posts (the rule of api.get_public_post), so a hidden post and an unknown id
-- answer the same way.
CREATE OR REPLACE FUNCTION internal.get_post_engagement(p_post_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if p_post_ids is null or cardinality(p_post_ids) > 50 or array_position(p_post_ids, null) is not null then
    raise exception 'engagement request is invalid' using errcode='22023', detail='engagement_invalid';
  end if;
  return jsonb_build_object('items', coalesce((
    select jsonb_agg(jsonb_build_object('post_id', d.post_id,
        'views', coalesce(t.views, 0), 'likes', coalesce(t.likes, 0)) order by d.post_id)
    from private.post_search_documents d
    left join private.post_engagement_totals t on t.post_id = d.post_id
    where d.post_id = any(p_post_ids) and d.is_visible
      and (d.visible_until is null or d.visible_until > statement_timestamp())
      and exists(select 1 from private.public_eligible_posts e where e.id = d.post_id)), '[]'::jsonb));
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

-- Daily, from internal.run_retention: view marks older than 24 hours (the
-- dedupe window) and salts older than yesterday, in batches of 10,000 marks
-- (at most 200,000 a run; the rest the next day), and waiting likes that are
-- due (at most 10,000 a run).
CREATE OR REPLACE FUNCTION internal.purge_post_engagement()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  today date := (statement_timestamp() at time zone 'Africa/Johannesburg')::date;
  salts integer; marks integer := 0; batch integer; rounds integer := 0; released integer;
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
  return jsonb_build_object('salts', salts, 'marks', marks, 'likes_released', released);
end;
$function$;
alter function internal.purge_post_engagement() owner to postgres;
revoke all on function internal.purge_post_engagement() from public, anon, authenticated, service_role;

-- The privacy export: datasets post_likes and post_likes_summary added before
-- notifications.
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
    ('post_likes',$q$select l.post_id,l.created_at from (select post_id,created_at,id from private.post_likes
      where account_id=$1 order by created_at desc,id limit 2000) l$q$),
    ('post_likes_summary',$q$select count(*) total,min(created_at) first_at,max(created_at) last_at
      from private.post_likes where account_id=$1$q$),
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

-- The retention job: also the view salts and marks, and waiting likes ("engagement").
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
    'engagement',internal.purge_post_engagement());
  perform pg_catalog.set_config('vm.retention','off',true);
  return result;
end;
$function$;
alter function internal.run_retention(integer) owner to postgres;
revoke all on function internal.run_retention(integer) from public;
grant execute on function internal.run_retention(integer) to service_role;

-- Account erasure: also the account's likes.
CREATE OR REPLACE FUNCTION internal.erase_closed_account(p_user uuid, p_by text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare er private.account_erasures; reason text; earlier_retention text; counts jsonb := '{}'::jsonb; n integer;
begin
  if p_user is null or p_by is null or p_by not in ('staff', 'sweep') then
    raise exception 'account and erasing party required' using errcode = '22023';
  end if;
  perform internal.lock_evidence_subject(p_user);
  select * into er from private.account_erasures e where e.user_id = p_user for update;
  if not found then raise exception 'account is not closed' using errcode = 'PT404', detail = 'account_not_closed'; end if;
  if er.erased_at is not null or er.erase_after > statement_timestamp() then
    return internal.account_erasure_state(p_user);
  end if;
  reason := internal.account_erasure_hold(p_user);
  if reason is not null then
    update private.account_erasures set blocked_at = statement_timestamp(), blocked_reason = reason
      where user_id = p_user;
    return internal.account_erasure_state(p_user);
  end if;
  earlier_retention := coalesce(pg_catalog.current_setting('vm.retention', true), '');
  perform pg_catalog.set_config('vm.retention', 'on', true);
  perform pg_catalog.set_config('vm.erasure', p_user::text, true);

  select count(*) into n from private.enquiries q where q.owner_id = p_user or q.sender_account_id = p_user;
  counts := counts || jsonb_build_object('enquiries', n);
  -- Enquiries the account sent, with the other owner's notice and email.
  with gone as (
    delete from private.enquiries q where q.sender_account_id = p_user returning q.id
  ), notices as (
    delete from private.notifications x using gone where x.kind = 'enquiry_received' and x.subject_id = gone.id
  )
  delete from private.outbox_events o using gone where o.kind = 'enquiry_received' and o.subject_id = gone.id;
  -- Sponsored places first: deleting a place returns its grant.
  delete from private.organisation_sponsorships s where s.owner_id = p_user;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('sponsored_places', n);
  -- Posts, with their edit copies, contacts, media links, search documents,
  -- received enquiries and everything else that belongs to a post.
  delete from private.posts p where p.owner_id = p_user;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('posts', n);
  delete from private.event_submissions e where e.owner_id = p_user;
  delete from private.enquiries q where q.owner_id = p_user;
  delete from private.notifications x where x.account_id = p_user;
  delete from private.outbox_events o where o.owner_id = p_user;
  delete from private.profiles x where x.account_id = p_user;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('profile', n);
  -- Likes made signed in (20261119172135_post_views_and_likes.sql).
  delete from private.post_likes l where l.account_id = p_user;
  delete from private.frontend_form_drafts d where d.owner_id = p_user;
  delete from private.listing_price_drafts d where d.owner_id = p_user;
  delete from private.intro_trial_requests t where t.owner_id = p_user;
  delete from private.frontend_business_checks b where b.owner_id = p_user;
  delete from private.organisation_admins a where a.account_id = p_user;
  delete from private.organisation_applications a where a.applicant_id = p_user;
  delete from private.entitlement_members m where m.member_id = p_user or m.added_by = p_user
    or m.entitlement_id in (select e.id from private.entitlements e where e.owner_id = p_user);
  delete from private.frontend_post_commands c where c.owner_id = p_user;
  delete from private.frontend_post_action_receipts r where r.owner_id = p_user;
  delete from private.account_acquisitions a where a.account_id = p_user;
  delete from private.communication_choice_events c where c.account_id = p_user;
  delete from private.signup_terms_acceptances a where a.account_id = p_user;
  delete from private.posting_terms_acceptances a where a.owner_id = p_user;
  delete from private.verification_localities l where l.owner_id = p_user;
  -- Photos and videos nothing kept still uses: queued for deletion from
  -- storage now (the media cleanup job deletes the objects).
  update private.media_objects m set state = 'cleanup_required', cleanup_lease_until = null
    where m.owner_id = p_user and m.state in ('intent', 'ready', 'rejected') and not internal.media_object_in_use(m.id);
  get diagnostics n = row_count; counts := counts || jsonb_build_object('media_queued', n);

  -- Paid time ends; payment records stay for their tax years, no longer
  -- linked to the account.
  update private.entitlements e set status = 'revoked', revoked_reason = 'account_erased'
    where e.owner_id = p_user and e.status <> 'revoked';
  update private.trial_identities t set owner_id = null, entitlement_id = null,
      detached_at = er.closed_at, retain_until = er.closed_at + interval '3 years'
    where t.owner_id = p_user;
  update private.post_activations a set owner_id = null where a.owner_id = p_user;
  update private.entitlements e set owner_id = null where e.owner_id = p_user;
  update private.payments p set owner_id = null where p.owner_id = p_user;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('payments_unlinked', n);
  update private.customer_invoices i set account_id = null where i.account_id = p_user;
  update private.invoice_transfers t set account_id = null where t.account_id = p_user;
  update private.payment_refund_requests r set account_id = null where r.account_id = p_user;
  update private.partner_commissions c set referred_account_id = null where c.referred_account_id = p_user;
  update private.individual_slot_limits l set account_id = null where l.account_id = p_user;
  update private.slot_packages k set owner_id = null where k.owner_id = p_user;
  -- Package invoice requests (20261119025106): an open one is withdrawn (it
  -- leaves the staff queue), then every one is kept unlinked like its invoice.
  update private.package_invoice_requests r set status = 'withdrawn', closed_at = statement_timestamp()
    where r.account_id = p_user and r.status in ('requested', 'awaiting_approval');
  update private.package_invoice_requests r set account_id = null where r.account_id = p_user;

  perform internal.remove_account_sign_in(p_user);
  perform pg_catalog.set_config('vm.erasure', '', true);
  perform pg_catalog.set_config('vm.retention', earlier_retention, true);
  update private.account_erasures set erased_at = statement_timestamp(), erased_by = p_by, erased_counts = counts,
      blocked_at = null, blocked_reason = null, auth_checked_at = statement_timestamp()
    where user_id = p_user;
  -- Deleting the Auth user never undoes the finished erasure: a failure is
  -- recorded and the daily check tries again.
  begin
    if internal.remove_erased_auth_user(p_user) then
      update private.account_erasures set auth_removed_at = statement_timestamp() where user_id = p_user;
    end if;
  exception when others then
    update private.account_erasures set blocked_at = statement_timestamp(), blocked_reason = 'error',
        blocked_detail = sqlstate
      where user_id = p_user;
  end;
  return internal.account_erasure_state(p_user);
end;
$function$;
alter function internal.erase_closed_account(uuid,text) owner to postgres;
revoke all on function internal.erase_closed_account(uuid,text) from public;

notify pgrst,'reload schema';
commit;
