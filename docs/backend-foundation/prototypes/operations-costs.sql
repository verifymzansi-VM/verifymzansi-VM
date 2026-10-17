-- Cost overview and alarms (DEC-29). Everything on the platform that grows a
-- bill is measured here from the database, compared with the free allowance of
-- the service that charges for it, and raised as an alarm at 70% and 90%.
-- Allowances are configuration, not facts: each row says where the number
-- comes from and must be re-checked against the provider's current pricing
-- (verified_on stays null until someone has done that). Usage that the
-- database cannot see (Worker requests, network egress, email provider sends)
-- is listed with its source so the dashboard shows it as "check provider".

insert into private.staff_capabilities (role, capability, requires_recent_mfa) values
  ('admin', 'cost:view', false),
  ('admin', 'cost:acknowledge', true);

create table private.cost_allowances (
  metric text primary key check (metric ~ '^[a-z_]+$'),
  label text not null check (length(label) between 3 and 120),
  unit text not null check (unit in ('bytes', 'count')),
  free_quantity numeric check (free_quantity is null or free_quantity > 0),
  period text not null check (period in ('current', 'month', 'day')),
  provider text not null check (length(provider) between 2 and 60),
  overage_note text not null check (length(overage_note) between 3 and 300),
  measured_in_database boolean not null,
  measurement text not null default 'database_observation' check(measurement in('database_observation','estimate','provider_required')),
  billing_scope text not null default 'unverified' check(billing_scope in('unverified','account','organization','project','contract')),
  source_url text check(source_url is null or source_url ~ '^https://'),
  verified_on date
);
insert into private.cost_allowances
  (metric, label, unit, free_quantity, period, provider, overage_note, measured_in_database) values
  ('object_storage_bytes', 'Photos, videos and ID documents stored', 'bytes', 10737418240, 'current', 'Cloudflare R2',
    'Free tier about 10 GB-month; beyond that billed per GB-month (check current R2 pricing)', true),
  ('object_writes_month', 'Files written this month (uploads and display copies)', 'count', 1000000, 'month', 'Cloudflare R2',
    'Class A operations: free tier about 1 million per month (check current R2 pricing)', true),
  ('database_bytes', 'Database size', 'bytes', 524288000, 'current', 'Supabase',
    'Free plan database about 500 MB per project; larger needs a paid plan (check current Supabase pricing)', true),
  ('monthly_active_users', 'People who signed in during the last 30 days', 'count', 50000, 'month', 'Supabase Auth',
    'Free plan about 50,000 monthly active users (check current Supabase pricing)', true),
  ('notifications_month', 'Notifications queued this month (emails and in-app)', 'count', null, 'month', 'Email provider',
    'Depends on the email provider plan; compare with its monthly send allowance', true),
  ('payments_month', 'Completed payments this month', 'count', null, 'month', 'Payment provider',
    'Each payment carries a provider fee; see the provider statement', true),
  ('worker_requests_day', 'Website requests per day', 'count', 100000, 'current', 'Cloudflare Workers',
    'Free plan about 100,000 requests per day; read from the Cloudflare dashboard', false),
  ('database_egress_month', 'Data sent out of the database this month', 'bytes', 5368709120, 'month', 'Supabase',
    'Free plan about 5 GB per month; read from the Supabase usage page', false);

-- Local observations are not provider bills. Reserved uploads and assumed
-- display derivatives are estimates; account entitlement/scope stays unverified.
update private.cost_allowances set measurement='estimate' where metric in('object_storage_bytes','object_writes_month');
update private.cost_allowances set measurement='provider_required' where not measured_in_database;
update private.cost_allowances set period='day' where metric='worker_requests_day';
update private.cost_allowances set source_url=case provider
  when 'Cloudflare R2' then 'https://developers.cloudflare.com/r2/pricing/'
  when 'Cloudflare Workers' then 'https://developers.cloudflare.com/workers/platform/pricing/'
  when 'Supabase' then 'https://supabase.com/pricing' end;
-- One row per metric, level and applicable UTC calendar period.
create table private.cost_alarms (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  metric text not null references private.cost_allowances (metric) on delete restrict,
  level text not null check (level in ('warning', 'critical')),
  period text not null check (period ~ '^[0-9]{4}-[0-9]{2}(-[0-9]{2})?$'),
  used numeric not null check (used >= 0),
  free_quantity numeric not null check (free_quantity > 0),
  raised_at timestamptz not null default statement_timestamp(),
  acknowledged_by uuid references auth.users (id) on delete restrict,
  acknowledged_at timestamptz,
  unique (metric, level, period),
  check ((acknowledged_by is null) = (acknowledged_at is null))
);
alter table private.cost_allowances enable row level security;
alter table private.cost_alarms enable row level security;
revoke all on private.cost_allowances, private.cost_alarms from public, anon, authenticated, service_role;

-- Current usage of every metric the database can measure.
create function internal.cost_usage()
returns table (metric text, used numeric) language sql stable security invoker set search_path = pg_catalog as $$
  select 'object_storage_bytes',
    (select coalesce(sum(greatest(coalesce(m.size_bytes, 0), m.declared_bytes)), 0)
       from private.media_objects m where m.state <> 'deleted')
    -- three resized display copies per photo, about 0.5 MB together
    + (select count(*) * 524288 from private.media_objects m where m.state = 'ready' and m.kind = 'image')
    + (select coalesce(sum(a.size_bytes), 0) from private.evidence_artifacts a where a.state <> 'deleted')
  union all
  select 'object_writes_month',
    (select count(*) * 4 from private.media_objects m where m.kind = 'image'
       and m.created_at >= date_trunc('month', statement_timestamp() at time zone 'UTC') at time zone 'UTC')
    + (select count(*) from private.media_objects m where m.kind = 'video'
       and m.created_at >= date_trunc('month', statement_timestamp() at time zone 'UTC') at time zone 'UTC')
    + (select count(*) from private.evidence_artifacts a
       where a.created_at >= date_trunc('month', statement_timestamp() at time zone 'UTC') at time zone 'UTC')
  union all
  select 'database_bytes', pg_catalog.pg_database_size(pg_catalog.current_database())::numeric
  union all
  select 'monthly_active_users', (select count(*) from auth.users u
    where u.last_sign_in_at > statement_timestamp() - interval '30 days')::numeric
  union all
  select 'notifications_month', (select count(*) from private.outbox_events o
    where o.created_at >= date_trunc('month', statement_timestamp() at time zone 'UTC') at time zone 'UTC')::numeric
  union all
  select 'payments_month', (select count(*) from private.payments p where p.completed_at >= date_trunc('month', statement_timestamp() at time zone 'UTC') at time zone 'UTC')::numeric;
$$;
revoke all on function internal.cost_usage() from public, anon, authenticated, service_role;

-- Admin cost dashboard: each cost line with its free allowance and level, the
-- activity that drives it, the biggest storage users and any open alarms.
create function internal.staff_cost_overview()
returns jsonb language plpgsql stable security definer set search_path = pg_catalog as $$
declare actor uuid := internal.staff_actor('cost:view');
begin
  return jsonb_build_object(
    'generated_at', statement_timestamp(),
    'lines', (select jsonb_agg(jsonb_build_object('metric', a.metric, 'label', a.label, 'unit', a.unit,
        'provider', a.provider, 'period', a.period, 'used', u.used::text,
        'free_quantity', a.free_quantity::text, 'measurement',a.measurement,'billing_scope',a.billing_scope,'source_url',a.source_url,
        'percent_of_free', case when a.free_quantity is not null and u.used is not null and a.verified_on is not null and a.billing_scope<>'unverified' and a.measurement='database_observation'
          then round(100 * u.used / a.free_quantity, 1) end,
        'level', case when u.used is null or a.measurement='provider_required' then 'check_provider'
          when a.free_quantity is null then 'allowance_unknown'
          when a.verified_on is null or a.billing_scope='unverified' then 'unverified_allowance'
          when a.measurement='estimate' then 'estimated_usage'
          when u.used >= a.free_quantity * 0.9 then 'critical'
          when u.used >= a.free_quantity * 0.7 then 'warning' else 'ok' end,
        'overage_note', a.overage_note, 'verified_on', a.verified_on) order by a.metric)
      from private.cost_allowances a left join internal.cost_usage() u on u.metric = a.metric),
    'drivers', jsonb_build_object(
      'accounts', (select count(*) from auth.users u where u.deleted_at is null),
      'new_accounts_this_month', (select count(*) from auth.users u
        where u.created_at >= date_trunc('month', statement_timestamp() at time zone 'UTC') at time zone 'UTC'),
      'posts_by_status', coalesce((select jsonb_object_agg(x.status, x.n) from
        (select p.status, count(*) as n from private.posts p group by p.status) x), '{}'),
      'live_posts', (select count(*) from private.posts p where p.status = 'live'),
      'uploads_last_30_days', (select count(*) from private.media_objects m
        where m.created_at > statement_timestamp() - interval '30 days'),
      'average_bytes_per_live_post', (select coalesce(round(avg(t.bytes)), 0)::text from (
        select coalesce(sum(x.bytes),0) as bytes from private.posts p left join (
          select distinct pm.post_id,m.id,greatest(coalesce(m.size_bytes,0),m.declared_bytes) as bytes
          from private.post_media pm join private.media_objects m on m.id=pm.object_id
        ) x on x.post_id=p.id where p.status='live' group by p.id) t),
      'unused_media_bytes_awaiting_cleanup', (select coalesce(sum(greatest(coalesce(m.size_bytes, 0), m.declared_bytes)), 0)::text
        from private.media_objects m where m.state in ('intent', 'rejected', 'cleanup_required')),
      'expired_posts_awaiting_deletion', (select count(*) from private.posts p where p.status in ('expired', 'sold', 'archived')),
      'evidence_files', (select count(*) from private.evidence_artifacts a where a.state <> 'deleted')),
    'largest_storage_accounts', coalesce((select jsonb_agg(jsonb_build_object('account_id',t.account_id,'bytes',t.bytes::text,'live_posts',t.live_posts,'package_posts',t.package_posts) order by t.bytes desc) from (
        select m.owner_id as account_id, sum(greatest(coalesce(m.size_bytes, 0), m.declared_bytes))::bigint as bytes,
          (select count(*) from private.posts p where p.owner_id = m.owner_id and p.status = 'live') as live_posts,
          (select c.posts from internal.package_capacity(m.owner_id) c) as package_posts
        from (
          select owner_id,greatest(coalesce(size_bytes,0),declared_bytes) as declared_bytes,size_bytes
          from private.media_objects where state<>'deleted'
          union all
          select owner_id,coalesce(size_bytes,0),size_bytes from private.evidence_artifacts where state<>'deleted'
        ) m group by m.owner_id order by 2 desc,m.owner_id limit 10) t), '[]'),
    'open_alarms', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'metric', c.metric, 'level', c.level,
        'period', c.period, 'used', c.used::text, 'free_quantity', c.free_quantity::text, 'raised_at', c.raised_at)
        order by c.raised_at desc)
      from private.cost_alarms c where c.acknowledged_at is null), '[]'));
end;
$$;
revoke all on function internal.staff_cost_overview() from public, anon, authenticated, service_role;
grant execute on function internal.staff_cost_overview() to authenticated;
create function api.staff_cost_overview()
returns jsonb language sql stable security invoker set search_path = pg_catalog as $$
  select internal.staff_cost_overview();
$$;
revoke all on function api.staff_cost_overview() from public, anon, authenticated, service_role;
grant execute on function api.staff_cost_overview() to authenticated;

-- Server job, run hourly: raise each metric's warning (70%) and critical (90%)
-- alarm once per month. Returns how many new alarms were raised.
create function internal.check_cost_alarms()
returns integer language plpgsql security definer set search_path = pg_catalog as $$
declare n integer;
begin
  insert into private.cost_alarms (metric, level, period, used, free_quantity)
  select a.metric, l.level, to_char(statement_timestamp() at time zone 'UTC', case when a.period='day' then 'YYYY-MM-DD' else 'YYYY-MM' end), u.used, a.free_quantity
  from private.cost_allowances a join internal.cost_usage() u on u.metric = a.metric
  cross join (values ('warning', 0.7), ('critical', 0.9)) l (level, share)
  where a.measurement='database_observation' and a.verified_on is not null and a.billing_scope<>'unverified' and a.free_quantity is not null and u.used >= a.free_quantity * l.share
  on conflict (metric, level, period) do nothing;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function internal.check_cost_alarms() from public, anon, authenticated, service_role;
grant execute on function internal.check_cost_alarms() to service_role;
create function api.check_cost_alarms()
returns integer language sql security invoker set search_path = pg_catalog as $$
  select internal.check_cost_alarms();
$$;
revoke all on function api.check_cost_alarms() from public, anon, authenticated, service_role;
grant execute on function api.check_cost_alarms() to service_role;

-- Admin: mark an alarm as seen. It stays recorded.
create function internal.acknowledge_cost_alarm(p_alarm_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare actor uuid := internal.staff_actor('cost:acknowledge'); alarm private.cost_alarms;
begin
  update private.cost_alarms set acknowledged_by = actor, acknowledged_at = statement_timestamp()
  where id = p_alarm_id and acknowledged_at is null returning * into alarm;
  if alarm.id is null then raise exception 'open alarm not found' using errcode = '22023'; end if;
  actor:=internal.staff_actor('cost:acknowledge'); -- final authority after the alarm row wait
  return jsonb_build_object('id', alarm.id, 'acknowledged_at', alarm.acknowledged_at);
end;
$$;
revoke all on function internal.acknowledge_cost_alarm(uuid) from public, anon, authenticated, service_role;
grant execute on function internal.acknowledge_cost_alarm(uuid) to authenticated;
create function api.acknowledge_cost_alarm(p_alarm_id uuid)
returns jsonb language sql security invoker set search_path = pg_catalog as $$
  select internal.acknowledge_cost_alarm(p_alarm_id);
$$;
revoke all on function api.acknowledge_cost_alarm(uuid) from public, anon, authenticated, service_role;
grant execute on function api.acknowledge_cost_alarm(uuid) to authenticated;
