-- Switch to posting Terms v4 and pause paid plans (owner decision of
-- 12 November 2026: switch now; nothing is sold at the old prices; paid slots
-- open again with the R69 checkout).
--
-- Apply after 20261112122001_publish_posting_terms_v4.sql, which publishes
-- posting-v4 (canonical hash pinned below); this file refuses to run without it.
-- In one transaction it:
-- 1. takes every plan version on sale off sale (sets retired_at, the only
--    catalogue column that may change; the rows stay as history, prices are
--    never edited) and records each one in private.plan_sale_pauses, so the
--    reviewed rollback can put exactly those plans back on sale;
-- 2. makes posting-v4 the current posting terms. Every member then accepts
--    posting-v4 once before their next submission or edit.
-- Free posting is unchanged: the free 7-day first post, free events, sponsored
-- places and staff grants do not use the catalogue. Entitlements, payments and
-- add-on versions are not touched (add-on sales stay paused by the website).
--
-- A plan payment already pending is left alone: if it is paid, it settles as
-- before and the member keeps the plan they paid for (the website starts no
-- new plan checkout once nothing is on sale). Run again after the switch it
-- changes nothing; in particular it never takes off sale plans that were
-- published after the switch.
begin;
set local lock_timeout='5s';

-- Precondition: the record table is absent, or exactly this update's.
do $$
declare shape text;
begin
  select coalesce((select string_agg(a.attname||':'||pg_catalog.format_type(a.atttypid,a.atttypmod)
      ||case when a.attnotnull then '!' else '' end, ',' order by a.attnum)
    from pg_catalog.pg_attribute a where a.attrelid=to_regclass('private.plan_sale_pauses')
      and a.attnum>0 and not a.attisdropped),'absent') into shape;
  if shape not in ('absent',
      'plan_version_id:uuid!,retired_at:timestamp with time zone!,reason:text!') then
    raise exception 'plan_sale_pauses drift: %', shape using errcode='55000';
  end if;
end$$;

create table if not exists private.plan_sale_pauses (
  plan_version_id uuid primary key references private.plan_versions (id) on delete restrict,
  retired_at timestamptz not null,
  reason text not null check (reason = 'posting_terms_v4_switch')
);
alter table private.plan_sale_pauses enable row level security;
revoke all on table private.plan_sale_pauses from public, anon, authenticated, service_role;

do $$
declare current_version text; v4_hash text; paused integer;
begin
  select c.version into current_version from private.posting_terms_current c where c.singleton for update;
  if current_version is null or current_version not in('posting-v3','posting-v4') then
    raise exception 'switch precondition: current posting terms are %, expected posting-v3',
      coalesce(current_version,'missing') using errcode='55000';
  end if;
  select v.document_hash into v4_hash from private.posting_terms_versions v where v.version='posting-v4';
  if v4_hash is distinct from 'FY2SZ6MjR1JpSry2hR4DRbhsGhzoDpkeHvAVdbfQmGs' then
    raise exception 'switch precondition: apply 20261112122001_publish_posting_terms_v4.sql first (posting-v4 is %)',
      case when v4_hash is null then 'not published' else 'published with a different document' end
      using errcode='55000';
  end if;
  if current_version='posting-v4' then
    return; -- already switched: nothing to take off sale again
  end if;
  lock table private.plan_versions in share row exclusive mode;
  with retired as (
    update private.plan_versions v set retired_at=statement_timestamp()
      where v.is_public and v.retired_at is null
      returning v.id, v.retired_at)
  insert into private.plan_sale_pauses(plan_version_id,retired_at,reason)
    select r.id, r.retired_at, 'posting_terms_v4_switch' from retired r;
  get diagnostics paused = row_count;
  raise notice 'plans taken off sale: %', paused;
end$$;

update private.posting_terms_current set version='posting-v4' where singleton and version<>'posting-v4';

do $$begin
  if (select c.version from private.posting_terms_current c where c.singleton) is distinct from 'posting-v4' then
    raise exception 'posting-v4 was not made current';
  end if;
  if exists(select 1 from private.plan_versions v
      where v.is_public and v.retired_at is null and v.created_at<=(select min(s.retired_at) from private.plan_sale_pauses s)) then
    raise exception 'a plan published before the switch is still on sale';
  end if;
end$$;
commit;
