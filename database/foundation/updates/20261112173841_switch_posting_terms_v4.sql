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
-- 2. lets a draft without a slot prepare the free first post's media
--    allowance (10 photos, 1 video) when no plan is on sale
--    (internal.set_post_media; before, it took the largest allowance of the
--    plans on sale, and with none it refused, so free posts could not add
--    photos);
-- 3. makes posting-v4 the current posting terms. Every member then accepts
--    posting-v4 once before their next submission or edit.
-- Free posting keeps working: the free 7-day first post, free events,
-- sponsored places and staff grants do not need a plan on sale. Entitlements,
-- payments and add-on versions are not touched (add-on sales stay paused by
-- the website).
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

-- Precondition: internal.set_post_media is the reviewed body this update
-- replaces (or already this update's, on a repeated run).
do $$
declare body text;
begin
  select md5(replace(p.prosrc,E'\r\n',E'\n')) into body from pg_catalog.pg_proc p
    where p.oid=to_regprocedure('internal.set_post_media(uuid,integer,jsonb)');
  if body is distinct from '57100d9ec7d5b8ac75c24aadc573512b'
      and body is distinct from '3ff7aba47039b8f074318e796718f85d' then
    raise exception 'internal.set_post_media is not the reviewed body (%)', coalesce(body,'missing')
      using errcode='55000';
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
  if v4_hash is distinct from 'HnObmeyoZjiuPQSF0z0aUgs_t_st87EUjVQGjDahozg' then
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

-- Drafts without a slot took their media allowance from the plans on sale;
-- with none on sale they fall back to the free first post's allowance, so
-- free posting keeps working while paid plans are paused.
CREATE OR REPLACE FUNCTION internal.set_post_media(p_post_id uuid, p_expected_revision integer, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  actor uuid := internal.price_draft_actor();
  post private.posts;
  photo_limit integer;
  video_limit integer;
  rev integer;
begin
  -- Edit mutations lock the original before their copy, matching approval and cleanup.
  perform original.id from private.posts original join private.posts copy on copy.edit_of=original.id
    where copy.id=p_post_id and copy.owner_id=actor for update of original;
  perform internal.assert_post_revision(p_expected_revision);
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) > 62 then
    raise exception 'invalid media list' using errcode = '22023';
  end if;
  select * into post from private.posts p where p.id = p_post_id and p.owner_id = actor for update;
  if not found then raise exception 'post not found' using errcode = '22023'; end if;
  if post.status not in ('draft', 'rejected', 'paused') then
    raise exception 'only drafts can be edited' using errcode = '22023';
  end if;
  if post.revision <> p_expected_revision then raise exception 'post changed' using errcode = 'PT409'; end if;
  if post.kind='event' then
    photo_limit:=10; video_limit:=1; -- Free event product allowance, not paid funding.
  else
    select e.max_photos,e.max_videos into photo_limit,video_limit
    from private.post_activations a join private.entitlements e on e.id=a.entitlement_id
    where a.post_id=post.id and a.owner_id=actor and a.released_at is null
      and internal.entitlement_usable(e.status,e.starts_at,e.ends_at)
      and (e.area is null or e.area=post.area)
      and (e.owner_id=actor or exists(select 1 from private.entitlement_members m where m.entitlement_id=e.id and m.member_id=actor))
      and exists(select 1 from private.current_account_access u where u.id=e.owner_id)
      and (e.source<>'retail_paid' or exists(select 1 from private.payments pay where pay.id=e.payment_id and pay.owner_id=e.owner_id and pay.status='complete'));
    if not found then
      -- Unfunded drafts can prepare the current public product allowance.
      -- Submission still checks the exact entitlement selected atomically.
      select max(v.max_photos),max(v.max_videos) into photo_limit,video_limit
      from private.plan_versions v where v.is_public and v.retired_at is null and (v.area is null or v.area=post.area);
      -- With no plan on sale (paid plans paused), drafts prepare the free first
      -- post's allowance (internal.grant_intro_trial: 10 photos, 1 video).
      if photo_limit is null or video_limit is null then
        photo_limit:=10; video_limit:=1;
      end if;
    end if;
  end if;
  if photo_limit is null or video_limit is null then
    raise exception 'no current media allowance available' using errcode='PT409';
  end if;
  if exists (select 1 from jsonb_array_elements(p_items) i
      where jsonb_typeof(i) <> 'object'
        or not (array(select jsonb_object_keys(i)) <@ array['object_id', 'purpose', 'position', 'focal_x', 'focal_y'])
        or i->>'purpose' not in ('cover', 'gallery', 'logo', 'video')
        or (i->>'object_id') !~ '^[0-9a-f-]{36}$' or (i->>'position') !~ '^[0-9]{1,2}$') then
    raise exception 'invalid media item' using errcode = '22023';
  end if;
  -- Lock before checking state; cleanup takes the same lock and rechecks links.
  perform m.id from private.media_objects m
    where m.owner_id=actor and m.id in (select (i->>'object_id')::uuid from jsonb_array_elements(p_items) i)
    order by m.id for update;
  -- Every object must be the owner's, finished, and the right kind for its purpose.
  if exists (select 1 from jsonb_array_elements(p_items) i
      left join private.media_objects m on m.id = (i->>'object_id')::uuid
      where m.id is null or m.owner_id <> actor or m.state <> 'ready'
        or (i->>'purpose' = 'video') <> (m.kind = 'video')) then
    raise exception 'media must be your own finished uploads of the right type' using errcode = '22023';
  end if;
  if (select count(*) from jsonb_array_elements(p_items) i where i->>'purpose' = 'cover') > 1
    or (select count(*) from jsonb_array_elements(p_items) i where i->>'purpose' = 'logo') > 1 then
    raise exception 'one cover and one logo at most' using errcode = '22023';
  end if;
  -- Per-post limits count distinct objects, so reuse costs nothing extra.
  if (select count(distinct i->>'object_id') from jsonb_array_elements(p_items) i where i->>'purpose' <> 'video') > photo_limit
    or (select count(distinct i->>'object_id') from jsonb_array_elements(p_items) i where i->>'purpose' = 'video') > video_limit then
    raise exception 'media exceed the current post allowance' using errcode = '22023';
  end if;
  delete from private.post_media where post_id = post.id;
  begin
    insert into private.post_media (post_id, object_id, purpose, position, focal_x, focal_y)
    select post.id, (i->>'object_id')::uuid, i->>'purpose', (i->>'position')::smallint,
      (i->>'focal_x')::numeric, (i->>'focal_y')::numeric
    from jsonb_array_elements(p_items) i;
  exception when unique_violation or check_violation then
    raise exception 'duplicate media position or invalid focal point' using errcode = '22023';
  end;
  update private.posts set revision = revision + 1, content_updated_at = statement_timestamp()
  where id = post.id returning revision into rev;
  perform internal.price_draft_actor(); -- final live owner/session check after all waits
  return jsonb_build_object('id', post.id, 'revision', rev);
end;
$function$;
revoke all on function internal.set_post_media(uuid,integer,jsonb) from public;
grant execute on function internal.set_post_media(uuid,integer,jsonb) to authenticated;

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
