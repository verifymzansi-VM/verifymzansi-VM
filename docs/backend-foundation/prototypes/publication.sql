-- BF-05 publication and media integrity candidate. A post goes
-- draft -> pending_moderation (owner submit, funded) -> live (staff approval,
-- which writes the search projection in the same commit) -> paused / sold /
-- archived / expired. Media are owned objects with an upload journal and a
-- per-account quota; posts link to them, so one object used as cover and in the
-- gallery counts once. Read-time rules hide anything not live, not visible or
-- past visible_until without waiting for a job.

-- Post content (nullable while drafting; required at submission per kind).
alter table private.posts
  add column title text check (title is null or length(title) between 1 and 120),
  add column description text check (description is null or length(description) <= 5000),
  add column province_id text references private.provinces (id),
  add column city_id text,
  add column locality_label text check (locality_label is null or length(locality_label) between 1 and 120),
  add column submitted_at timestamptz,
  add column published_at timestamptz,
  add column visible_until timestamptz,
  add column status_reason text check (status_reason is null or length(status_reason) <= 500);
alter table private.posts add constraint posts_city_province_fkey
  foreign key (city_id, province_id) references private.cities (id, province_id);
alter table private.posts add constraint posts_live_has_window
  check (status <> 'live' or (published_at is not null and visible_until is not null and visible_until > published_at));
create index posts_owner_submitted_idx on private.posts (owner_id, kind, submitted_at);

-- Live edits (source content_edit_requests): the owner edits a copy of a live
-- post with the normal draft commands while the approved version stays public.
-- Staff review the copy in the same queue; approval merges it into the live
-- post in one commit and deletes the copy. One open edit per post, two
-- approved edits per post (source MAX_APPROVED_CONTENT_EDITS). Queue claims and
-- reports are in moderation-queues.sql, applied after this file.
alter table private.posts add column edit_of uuid references private.posts (id) on delete cascade;
alter table private.posts add constraint posts_edit_copy_state
  check (edit_of is null or (edit_of <> id and status in ('draft', 'pending_moderation', 'rejected')));
create unique index posts_one_open_edit_idx on private.posts (edit_of) where edit_of is not null;

-- When the status last changed: the lifecycle sweep's clock (DEC-28/29).
alter table private.posts add column status_changed_at timestamptz not null default statement_timestamp();
create index posts_lifecycle_idx on private.posts (status, status_changed_at);
create function internal.post_status_clock()
returns trigger language plpgsql security invoker set search_path = pg_catalog as $$
begin
  if new.status is distinct from old.status then new.status_changed_at := statement_timestamp(); end if;
  return new;
end;
$$;
revoke all on function internal.post_status_clock() from public, anon, authenticated, service_role;
create trigger post_status_clock before update of status on private.posts
  for each row execute function internal.post_status_clock();

-- An edit copy keeps its live post's identity and category. While a copy
-- exists, the live post's content, details and media are frozen (lifecycle
-- columns may still change), so the copy is the single place being edited.
create function internal.post_edit_guard()
returns trigger language plpgsql security invoker set search_path = pg_catalog as $$
declare target uuid;
begin
  if tg_table_name = 'posts' then
    if tg_op = 'INSERT' then
      if new.edit_of is not null and not exists (select 1 from private.posts o where o.id = new.edit_of
          and o.edit_of is null and (o.owner_id, o.kind, o.area, o.category_key)
            = (new.owner_id, new.kind, new.area, new.category_key)) then
        raise exception 'an edit must match its live post' using errcode = '23514';
      end if;
      return new;
    end if;
    if new.edit_of is distinct from old.edit_of
      or (new.edit_of is not null and new.category_key is distinct from old.category_key) then
      raise exception 'an edit stays linked to its live post and category' using errcode = '23514';
    end if;
    if (new.category_key, new.activity_key, new.title, new.description, new.province_id, new.city_id, new.locality_label)
        is distinct from (old.category_key, old.activity_key, old.title, old.description, old.province_id, old.city_id, old.locality_label)
      and exists (select 1 from private.posts e where e.edit_of = new.id) then
      raise exception 'this post has an edit waiting for review' using errcode = '23514';
    end if;
    return new;
  end if;
  foreach target in array case tg_op when 'INSERT' then array[new.post_id] when 'DELETE' then array[old.post_id]
      else array[old.post_id, new.post_id] end loop
    -- A cascade from a deleted post is not an edit.
    if exists (select 1 from private.posts e where e.edit_of = target)
      and exists (select 1 from private.posts p where p.id = target) then
      raise exception 'this post has an edit waiting for review' using errcode = '23514';
    end if;
  end loop;
  return coalesce(new, old);
end;
$$;
revoke all on function internal.post_edit_guard() from public, anon, authenticated, service_role;
create trigger post_edit_link before insert or update on private.posts
  for each row execute function internal.post_edit_guard();
create trigger post_edit_listing_frozen before insert or update or delete on private.listing_details
  for each row execute function internal.post_edit_guard();
create trigger post_edit_business_frozen before insert or update or delete on private.business_details
  for each row execute function internal.post_edit_guard();
create trigger post_edit_event_frozen before insert or update or delete on private.event_details
  for each row execute function internal.post_edit_guard();

-- An edit copy never holds funding; it is reviewed against the live post's.
create function internal.post_activation_edit_guard()
returns trigger language plpgsql security invoker set search_path = pg_catalog as $$
begin
  if exists (select 1 from private.posts p where p.id = new.post_id and p.edit_of is not null) then
    raise exception 'an edit uses its live post''s funding' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function internal.post_activation_edit_guard() from public, anon, authenticated, service_role;
create trigger post_activation_not_edit before insert or update on private.post_activations
  for each row execute function internal.post_activation_edit_guard();

create table private.media_objects (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete restrict,
  kind text not null check (kind in ('image', 'video')),
  object_key text not null unique,
  declared_bytes integer not null check (declared_bytes > 0),
  size_bytes integer check (size_bytes > 0),
  sha256 text check (sha256 ~ '^[a-f0-9]{64}$'),
  mime text,
  width integer check (width between 1 and 20000),
  height integer check (height between 1 and 20000),
  state text not null default 'intent' check (state in ('intent', 'ready', 'rejected', 'cleanup_required', 'deleted')),
  created_at timestamptz not null default statement_timestamp(),
  state_changed_at timestamptz not null default statement_timestamp(),
  cleanup_token uuid,
  cleanup_lease_until timestamptz,
  cleanup_attempt integer not null default 0 check (cleanup_attempt >= 0),
  -- Last time a post stopped using this object. Cleanup waits 24 hours after
  -- it, so a deleted or expired post's photos can be reused in a new post.
  unlinked_at timestamptz,
  deleted_at timestamptz,
  -- Current site ceilings: images 5 MB, videos 50 MB.
  check ((kind = 'image' and declared_bytes <= 5242880) or (kind = 'video' and declared_bytes <= 52428800)),
  check (state <> 'ready' or (sha256 is not null and size_bytes is not null and size_bytes <= declared_bytes and mime is not null)),
  check ((state = 'deleted') = (deleted_at is not null))
);
create index media_objects_owner_idx on private.media_objects (owner_id) where state in ('intent', 'ready');

create function internal.media_object_transition_guard()
returns trigger language plpgsql security invoker set search_path = pg_catalog as $$
begin
  if (new.id, new.owner_id, new.kind, new.object_key, new.declared_bytes) is distinct from
     (old.id, old.owner_id, old.kind, old.object_key, old.declared_bytes) then
    raise exception 'media identity is immutable' using errcode = '23514';
  end if;
  if new.state <> old.state and not (
      (old.state = 'intent' and new.state in ('ready', 'rejected', 'cleanup_required'))
      or (old.state in ('ready', 'rejected') and new.state = 'cleanup_required')
      or (old.state = 'cleanup_required' and new.state = 'deleted')) then
    raise exception 'invalid media transition % -> %', old.state, new.state using errcode = '23514';
  end if;
  if old.sha256 is not null and new.sha256 is distinct from old.sha256 then
    raise exception 'media digest is immutable' using errcode = '23514';
  end if;
  new.state_changed_at := case when new.state <> old.state then statement_timestamp() else old.state_changed_at end;
  return new;
end;
$$;
revoke all on function internal.media_object_transition_guard() from public, anon, authenticated, service_role;
create trigger media_object_transition before update on private.media_objects
  for each row execute function internal.media_object_transition_guard();

create table private.post_media (
  post_id uuid not null references private.posts (id) on delete cascade,
  object_id uuid not null references private.media_objects (id) on delete restrict,
  purpose text not null check (purpose in ('cover', 'gallery', 'logo', 'video')),
  position smallint not null check (position between 0 and 49),
  focal_x numeric(4, 3) check (focal_x between 0 and 1),
  focal_y numeric(4, 3) check (focal_y between 0 and 1),
  primary key (post_id, purpose, position),
  unique (post_id, purpose, object_id)
);
create unique index post_media_one_cover_idx on private.post_media (post_id) where purpose = 'cover';
create unique index post_media_one_logo_idx on private.post_media (post_id) where purpose = 'logo';
create index post_media_object_idx on private.post_media (object_id);
create trigger post_edit_media_frozen before insert or update or delete on private.post_media
  for each row execute function internal.post_edit_guard();

-- Record when an object stops being used by a post (edit, delete, expiry sweep).
create function internal.media_unlink_clock()
returns trigger language plpgsql security invoker set search_path = pg_catalog as $$
begin
  update private.media_objects set unlinked_at = statement_timestamp() where id = old.object_id;
  return null;
end;
$$;
revoke all on function internal.media_unlink_clock() from public, anon, authenticated, service_role;
create trigger post_media_unlink_clock after delete or update of object_id on private.post_media
  for each row execute function internal.media_unlink_clock();

-- Append-only moderation history. post_id is a plain reference so deleting a
-- post (account deletion) never rewrites history. For a live edit, post_id is
-- the live post and edit_id the reviewed copy (also a plain reference).
create table private.moderation_log (
  id bigint generated always as identity primary key,
  post_id uuid not null,
  edit_id uuid,
  staff_id uuid not null references auth.users (id) on delete restrict,
  decision text not null check (decision in ('approve', 'reject')),
  post_revision integer not null,
  reason text,
  decided_at timestamptz not null default statement_timestamp(),
  price_only boolean not null default false,
  check (edit_id is distinct from post_id),
  check (not price_only or edit_id is not null)
);
create index moderation_log_approved_edits_idx on private.moderation_log (post_id)
  where edit_id is not null and decision = 'approve';
create trigger moderation_log_append_only before update or delete on private.moderation_log
  for each row execute function internal.append_only_guard();
create trigger moderation_log_no_truncate before truncate on private.moderation_log
  for each statement execute function internal.append_only_guard();

alter table private.media_objects enable row level security;
alter table private.post_media enable row level security;
alter table private.moderation_log enable row level security;
revoke all on private.media_objects, private.post_media, private.moderation_log
  from public, anon, authenticated, service_role;

insert into private.staff_capabilities (role, capability, requires_recent_mfa) values
  ('moderator', 'post:moderate', true),
  ('governor', 'post:moderate', true);

-- Owner: reserve an upload. The object key is random (it never reveals the
-- owner, because public post pages show it) and generated here; the server route
-- streams the bytes to exactly this key and then calls finalize_media.
create function internal.begin_media_upload(p_kind text, p_bytes integer)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare actor uuid := internal.price_draft_actor(); used bigint; obj private.media_objects;
begin
  if p_kind is null or p_kind not in ('image', 'video') or p_bytes is null or p_bytes < 1
    or (p_kind = 'image' and p_bytes > 5242880) or (p_kind = 'video' and p_bytes > 52428800) then
    raise exception 'images up to 5 MB, videos up to 50 MB' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text, 808));
  if (select count(*) from private.media_objects m where m.owner_id = actor and m.state = 'intent') >= 20 then
    raise exception 'too many unfinished uploads' using errcode = 'PT429';
  end if;
  select coalesce(sum(greatest(coalesce(m.size_bytes, 0), m.declared_bytes)), 0) into used
  from private.media_objects m where m.owner_id = actor and m.state <> 'deleted';
  if used + p_bytes > internal.media_storage_allowance(actor) then
    raise exception 'storage for your package is full; delete unused posts or drafts' using errcode = 'PT409';
  end if;
  insert into private.media_objects (owner_id, kind, object_key, declared_bytes)
  values (actor, p_kind, 'media/' || pg_catalog.gen_random_uuid(), p_bytes)
  returning * into obj;
  perform internal.price_draft_actor(); -- final live owner/session check after all waits
  return jsonb_build_object('object_id', obj.id, 'object_key', obj.object_key, 'max_bytes', obj.declared_bytes);
end;
$$;
revoke all on function internal.begin_media_upload(text, integer) from public, anon, authenticated, service_role;
grant execute on function internal.begin_media_upload(text, integer) to authenticated;
create function api.begin_media_upload(p_kind text, p_bytes integer)
returns jsonb language sql security invoker set search_path = pg_catalog as $$
  select internal.begin_media_upload(p_kind, p_bytes);
$$;
revoke all on function api.begin_media_upload(text, integer) from public, anon, authenticated, service_role;
grant execute on function api.begin_media_upload(text, integer) to authenticated;

-- Server: record what was actually stored. Anything outside the declared size
-- or allowed types becomes rejected (and is later cleaned up), never ready.
create function internal.finalize_media(p_object_id uuid, p_size integer, p_sha256 text, p_mime text,
  p_width integer, p_height integer)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare obj private.media_objects; ok boolean;
begin
  select * into obj from private.media_objects m where m.id = p_object_id for update;
  if not found or obj.state <> 'intent' then raise exception 'upload not pending' using errcode = '22023'; end if;
  ok := p_size between 1 and obj.declared_bytes and p_sha256 ~ '^[a-f0-9]{64}$'
    and ((obj.kind = 'image' and p_mime in ('image/jpeg', 'image/png', 'image/webp', 'image/avif')
          and p_width between 1 and 20000 and p_height between 1 and 20000)
      or (obj.kind = 'video' and p_mime in ('video/mp4', 'video/webm')));
  if ok then
    update private.media_objects set state = 'ready', size_bytes = p_size, sha256 = p_sha256, mime = p_mime,
      width = p_width, height = p_height where id = obj.id;
  else
    update private.media_objects set state = 'rejected',
      size_bytes = case when p_size > 0 then p_size else null end where id = obj.id;
  end if;
  return jsonb_build_object('object_id', obj.id, 'state', case when ok then 'ready' else 'rejected' end);
end;
$$;
revoke all on function internal.finalize_media(uuid, integer, text, text, integer, integer) from public, anon, authenticated, service_role;
grant execute on function internal.finalize_media(uuid, integer, text, text, integer, integer) to service_role;
create function api.finalize_media(p_object_id uuid, p_size integer, p_sha256 text, p_mime text,
  p_width integer default null, p_height integer default null)
returns jsonb language sql security invoker set search_path = pg_catalog as $$
  select internal.finalize_media(p_object_id, p_size, p_sha256, p_mime, p_width, p_height);
$$;
revoke all on function api.finalize_media(uuid, integer, text, text, integer, integer) from public, anon, authenticated, service_role;
grant execute on function api.finalize_media(uuid, integer, text, text, integer, integer) to service_role;

create function internal.assert_post_revision(p_revision integer)
returns void language plpgsql security invoker set search_path = pg_catalog as $$
begin
  if p_revision is null or p_revision not between 1 and 2147483646 then
    raise exception 'positive expected revision required' using errcode='22023';
  end if;
end;
$$;
revoke all on function internal.assert_post_revision(integer) from public,anon,authenticated,service_role;

-- Owner: edit draft content. Revision-fenced like every other draft command.
create function internal.save_post_content(p_post_id uuid, p_expected_revision integer, p_content jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare actor uuid := internal.price_draft_actor(); post private.posts; c jsonb := p_content; rev integer;
  city text; locality text; title_value text; description_value text;
begin
  -- Edit mutations lock the original before their copy, matching approval and cleanup.
  perform original.id from private.posts original join private.posts copy on copy.edit_of=original.id
    where copy.id=p_post_id and copy.owner_id=actor for update of original;
  perform internal.assert_post_revision(p_expected_revision);
  if jsonb_typeof(c) is distinct from 'object' or octet_length(c::text) > 12000
    or not (array(select jsonb_object_keys(c)) <@ array['title', 'description', 'province_id', 'city_id', 'locality_label'])
    or exists (select 1 from jsonb_each(c) e where jsonb_typeof(e.value) not in ('string', 'null')) then
    raise exception 'invalid content' using errcode = '22023';
  end if;
  select * into post from private.posts p where p.id = p_post_id and p.owner_id = actor for update;
  if not found then raise exception 'post not found' using errcode = '22023'; end if;
  if post.status not in ('draft', 'rejected', 'paused') then
    raise exception 'only drafts can be edited' using errcode = '22023';
  end if;
  if post.revision <> p_expected_revision then raise exception 'post changed' using errcode = 'PT409'; end if;
  if (c ? 'city_id' and c->>'city_id' is not null) and (c ? 'locality_label' and c->>'locality_label' is not null) then
    raise exception 'choose a listed city or type a locality, not both' using errcode = '22023';
  end if;
  if exists(select 1 from jsonb_each(c) e where e.key in ('title','description') and
    e.value #>> '{}' ~ U&'[\0001-\0008\000B-\000C\000E-\001F\007F\202A-\202E\2066-\2069\FEFF]') then
    raise exception 'remove hidden formatting characters' using errcode='22023';
  end if;
  if c->>'title' is not null then
    title_value := nullif(internal.validate_attribute_value(jsonb_build_object('type','string',
      'maxLength',case when post.kind='event' then 120 else 100 end),c->'title') #>> '{}','');
  end if;
  if c->>'description' is not null then
    description_value := nullif(internal.validate_attribute_value(jsonb_build_object('type','string',
      'maxLength',case when post.kind='business' then 3000 else 5000 end),c->'description') #>> '{}','');
  end if;
  if c->>'locality_label' is not null then
    locality := nullif(internal.validate_attribute_value('{"type":"string","maxLength":80}'::jsonb,
      c->'locality_label') #>> '{}','');
  end if;
  city := case when c ? 'city_id' then c->>'city_id'
    when locality is not null then null else post.city_id end;
  locality := case when c ? 'locality_label' then locality
    when c->>'city_id' is not null then null else post.locality_label end;
  if (city is not null and locality is not null) or (locality is not null and
    (length(locality)>80 or locality ~ U&'[\0001-\001F\007F-\009F\200B-\200F\202A-\202E\2060-\206F]')) then
    raise exception 'invalid public locality' using errcode='22023';
  end if;
  update private.posts set
    title = case when c ? 'title' then title_value else title end,
    description = case when c ? 'description' then description_value else description end,
    province_id = case when c ? 'province_id' then c->>'province_id' else province_id end,
    city_id = city,
    locality_label = locality,
    revision = revision + 1, content_updated_at = statement_timestamp()
  where id = post.id returning revision into rev;
  perform internal.price_draft_actor(); -- final live owner/session check after all waits
  return jsonb_build_object('id', post.id, 'revision', rev);
end;
$$;
revoke all on function internal.save_post_content(uuid, integer, jsonb) from public, anon, authenticated, service_role;
grant execute on function internal.save_post_content(uuid, integer, jsonb) to authenticated;
create function api.save_post_content(p_post_id uuid, p_expected_revision integer, p_content jsonb)
returns jsonb language sql security invoker set search_path = pg_catalog as $$
  select internal.save_post_content(p_post_id, p_expected_revision, p_content);
$$;
revoke all on function api.save_post_content(uuid, integer, jsonb) from public, anon, authenticated, service_role;
grant execute on function api.save_post_content(uuid, integer, jsonb) to authenticated;

-- Owner: replace a draft's media links in one step.
create function internal.set_post_media(p_post_id uuid, p_expected_revision integer, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
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
$$;
revoke all on function internal.set_post_media(uuid, integer, jsonb) from public, anon, authenticated, service_role;
grant execute on function internal.set_post_media(uuid, integer, jsonb) to authenticated;
create function api.set_post_media(p_post_id uuid, p_expected_revision integer, p_items jsonb)
returns jsonb language sql security invoker set search_path = pg_catalog as $$
  select internal.set_post_media(p_post_id, p_expected_revision, p_items);
$$;
revoke all on function api.set_post_media(uuid, integer, jsonb) from public, anon, authenticated, service_role;
grant execute on function api.set_post_media(uuid, integer, jsonb) to authenticated;

-- Owner: submit for moderation. Content and media rules per kind match the
-- current site; funding is reserved now (paid activation, or event fair use).
create function internal.submit_post(p_post_id uuid, p_expected_revision integer)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare
  actor uuid := internal.price_draft_actor();
  post private.posts;
  photos integer;
  videos integer;
  photo_limit integer;
  video_limit integer;
  rev integer;
begin
  -- Edit mutations lock the original before their copy, matching approval and cleanup.
  perform original.id from private.posts original join private.posts copy on copy.edit_of=original.id
    where copy.id=p_post_id and copy.owner_id=actor for update of original;
  perform internal.assert_post_revision(p_expected_revision);
  select * into post from private.posts p where p.id = p_post_id and p.owner_id = actor for update;
  if not found then raise exception 'post not found' using errcode = '22023'; end if;
  if post.status not in ('draft', 'rejected', 'paused') then
    raise exception 'this post cannot be submitted now' using errcode = '22023';
  end if;
  if post.revision <> p_expected_revision then raise exception 'post changed' using errcode = 'PT409'; end if;
  if post.title is null then
    raise exception 'title length does not meet the rules for this post type' using errcode = '22023';
  end if;
  perform internal.validate_attribute_value(jsonb_build_object('type','string',
    'minLength',case when post.kind='business' then 2 else 5 end,
    'maxLength',case when post.kind='event' then 120 else 100 end),to_jsonb(post.title));
  if post.kind in ('listing','event') and post.description is null then
    raise exception 'description length does not meet the rules for this post type' using errcode = '22023';
  end if;
  perform internal.validate_attribute_value(jsonb_build_object('type','string',
    'minLength',case when post.kind='business' then 0 else 20 end,
    'maxLength',case when post.kind='business' then 3000 else 5000 end),to_jsonb(coalesce(post.description,'')));
  if post.province_id is null or (post.city_id is null and post.locality_label is null) then
    raise exception 'province and city or locality required' using errcode = '22023';
  end if;
  if post.kind='listing' then
    if not exists(select 1 from private.listing_details d where d.post_id=post.id and d.price_mode is not null) then
      raise exception 'choose an explicit listing price' using errcode='22023';
    end if;
    perform internal.validate_listing_attributes(post.category_key,d.attributes,true)
      from private.listing_details d where d.post_id=post.id;
  end if;
  select count(distinct pm.object_id) into photos from private.post_media pm
    where pm.post_id = post.id and pm.purpose in ('cover', 'gallery');
  select count(distinct pm.object_id) into videos from private.post_media pm where pm.post_id=post.id and pm.purpose='video';
  if ((post.kind='listing' and post.category_key<>'jobs_services') or (post.kind='business' and post.area='tourism_events')) and photos = 0 then
    raise exception 'at least one photo is required' using errcode = '22023';
  end if;
  if post.kind='event' and photos+videos=0 then raise exception 'at least one photo or video required' using errcode='22023'; end if;
  if photos > 0 and not exists (select 1 from private.post_media pm where pm.post_id = post.id and pm.purpose = 'cover') then
    raise exception 'choose a cover photo' using errcode = '22023';
  end if;
  if exists (select 1 from private.post_media pm join private.media_objects m on m.id = pm.object_id
      where pm.post_id = post.id and m.state <> 'ready') then
    raise exception 'a linked upload is no longer available' using errcode = '22023';
  end if;
  if post.edit_of is not null then
    -- A live edit uses the live post's funding: no new activation or fair use.
    if not exists (select 1 from private.posts o where o.id = post.edit_of and o.status = 'live') then
      raise exception 'the live post is no longer published' using errcode = 'PT409';
    end if;
    if internal.edit_is_price_only(post.edit_of, post.id) then
      if internal.recent_price_change(post.edit_of) then
        raise exception 'one price change per day; try again tomorrow' using errcode = 'PT429';
      end if;
    elsif internal.approved_edit_count(post.edit_of) >= internal.edit_allowance(post.edit_of) then
      raise exception 'all edits for this post are used; a price-only change is still allowed' using errcode = 'PT409';
    end if;
    select f.max_photos, f.max_videos into photo_limit, video_limit
      from internal.post_funding(post.edit_of) f where f.funded_until > statement_timestamp();
    if not found then raise exception 'funding or event window has ended' using errcode = 'PT409'; end if;
    if (select count(distinct pm.object_id) from private.post_media pm where pm.post_id=post.id and pm.purpose<>'video')>photo_limit
      or videos>video_limit then
      raise exception 'media exceed the funded post allowance' using errcode = '22023';
    end if;
  elsif post.kind = 'event' then
    -- Free events: fair use of 5 active (pending or live) and 10 submissions per 30 days.
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text, 909));
    if (select count(*) from private.posts p where p.owner_id = actor and p.kind = 'event' and p.edit_of is null
          and p.status in ('pending_moderation', 'live') and p.id <> post.id) >= 5
      or (select count(*) from private.posts p where p.owner_id = actor and p.kind = 'event' and p.edit_of is null
          and p.submitted_at > statement_timestamp() - interval '30 days' and p.id <> post.id) >= 10 then
      raise exception 'event fair-use limit reached' using errcode = 'PT429';
    end if;
  else
    perform internal.activate_post(post.id);
    select e.max_photos,e.max_videos into photo_limit,video_limit
      from private.post_activations a join private.entitlements e on e.id=a.entitlement_id
      where a.post_id=post.id and a.released_at is null;
    if (select count(distinct pm.object_id) from private.post_media pm where pm.post_id=post.id and pm.purpose<>'video')>photo_limit
      or videos>video_limit then
      raise exception 'media exceed the funded post allowance' using errcode='22023';
    end if;
  end if;
  update private.posts set status = 'pending_moderation', submitted_at = statement_timestamp(),
    status_reason = null, revision = revision + 1
  where id = post.id returning revision into rev;
  perform internal.price_draft_actor(); -- final live owner/session check after all waits
  return jsonb_build_object('id', post.id, 'status', 'pending_moderation', 'revision', rev);
end;
$$;
revoke all on function internal.submit_post(uuid, integer) from public, anon, authenticated, service_role;
grant execute on function internal.submit_post(uuid, integer) to authenticated;
create function api.submit_post(p_post_id uuid, p_expected_revision integer)
returns jsonb language sql security invoker set search_path = pg_catalog as $$
  select internal.submit_post(p_post_id, p_expected_revision);
$$;
revoke all on function api.submit_post(uuid, integer) from public, anon, authenticated, service_role;
grant execute on function api.submit_post(uuid, integer) to authenticated;

-- Current funding of a post: an event's own window (free product allowance of
-- 10 photos and 1 video), or the live activation's usable entitlement. The same
-- predicate as public eligibility; a post with no row has no funding.
create function internal.post_funding(p_post_id uuid)
returns table (funded_until timestamptz, max_photos integer, max_videos integer)
language sql stable security invoker set search_path = pg_catalog as $$
  select e.ends_at, 10, 1
  from private.posts p join private.event_details e on e.post_id = p.id
  where p.id = p_post_id and p.kind = 'event'
  union all
  select e.ends_at, e.max_photos, e.max_videos
  from private.posts p
  join private.post_activations a on a.post_id = p.id and a.released_at is null and a.owner_id = p.owner_id
  join private.entitlements e on e.id = a.entitlement_id
  where p.id = p_post_id and p.kind <> 'event'
    and internal.entitlement_usable(e.status, e.starts_at, e.ends_at)
    and (e.area is null or e.area = p.area)
    and (e.owner_id = p.owner_id or exists (select 1 from private.entitlement_members m
      where m.entitlement_id = e.id and m.member_id = p.owner_id))
    and exists (select 1 from private.current_account_access u where u.id = e.owner_id)
    and (e.source <> 'retail_paid' or exists (select 1 from private.payments pay
      where pay.id = e.payment_id and pay.owner_id = e.owner_id and pay.status = 'complete'));
$$;
revoke all on function internal.post_funding(uuid) from public, anon, authenticated, service_role;

-- Approved edits that count against the allowance; price-only edits are free.
create function internal.approved_edit_count(p_post_id uuid)
returns integer language sql stable security invoker set search_path = pg_catalog as $$
  select count(*)::integer from private.moderation_log l
  where l.post_id = p_post_id and l.edit_id is not null and l.decision = 'approve' and not l.price_only;
$$;
revoke all on function internal.approved_edit_count(uuid) from public, anon, authenticated, service_role;

-- Edit allowance follows the package (DEC-29): 2 approved edits per started 30
-- days of the funding package (30 days 2, 90 days 6, 180 days 12), at least 2.
-- Free events and unfunded posts get 2.
create function internal.edit_allowance(p_post_id uuid)
returns integer language sql stable security invoker set search_path = pg_catalog as $$
  select coalesce((
    select greatest(2, 2 * ceil(extract(epoch from (e.ends_at - e.starts_at)) / 2592000.0))::integer
    from private.posts p
    join private.post_activations a on a.post_id = p.id and a.released_at is null
    join private.entitlements e on e.id = a.entitlement_id
    where p.id = p_post_id and p.kind <> 'event'
    order by e.ends_at desc limit 1), 2);
$$;
revoke all on function internal.edit_allowance(uuid) from public, anon, authenticated, service_role;

-- True when an edit copy changes only the listing price terms: same content
-- columns, same details apart from price, same media links, and a different price.
create function internal.edit_is_price_only(p_original_id uuid, p_edit_id uuid)
returns boolean language sql stable security invoker set search_path = pg_catalog as $$
  select coalesce((
    select o.kind = 'listing'
      and (o.category_key, o.activity_key, o.title, o.description, o.province_id, o.city_id, o.locality_label)
        is not distinct from (e.category_key, e.activity_key, e.title, e.description, e.province_id, e.city_id, e.locality_label)
      and (to_jsonb(od) - array['post_id', 'price_mode', 'price_cents', 'price_negotiable'])
        = (to_jsonb(ed) - array['post_id', 'price_mode', 'price_cents', 'price_negotiable'])
      and (od.price_mode, od.price_cents, od.price_negotiable) is distinct from (ed.price_mode, ed.price_cents, ed.price_negotiable)
      and coalesce((select jsonb_agg(to_jsonb(pm) - 'post_id' order by pm.purpose, pm.position)
             from private.post_media pm where pm.post_id = o.id), '[]')
        = coalesce((select jsonb_agg(to_jsonb(pm) - 'post_id' order by pm.purpose, pm.position)
             from private.post_media pm where pm.post_id = e.id), '[]')
    from private.posts o
    join private.posts e on e.id = p_edit_id and e.edit_of = o.id
    join private.listing_details od on od.post_id = o.id
    join private.listing_details ed on ed.post_id = e.id
    where o.id = p_original_id), false);
$$;
revoke all on function internal.edit_is_price_only(uuid, uuid) from public, anon, authenticated, service_role;

-- Price-only edits are free but limited to one approved change per 24 hours,
-- so staff are not asked to review a new price every few minutes.
create function internal.recent_price_change(p_post_id uuid)
returns boolean language sql stable security invoker set search_path = pg_catalog as $$
  select exists (select 1 from private.moderation_log l
    where l.post_id = p_post_id and l.price_only and l.decision = 'approve'
      and l.decided_at > statement_timestamp() - interval '24 hours');
$$;
revoke all on function internal.recent_price_change(uuid) from public, anon, authenticated, service_role;

-- Package-based limits (DEC-29) share one capacity: posts the owner's current
-- packages allow at once, and the largest per-post media allowance (10 photos
-- of 5 MB and 1 video of 50 MB by default).
create function internal.package_capacity(p_owner uuid, out posts integer, out post_media_bytes bigint)
language sql stable security invoker set search_path = pg_catalog as $$
  select coalesce(sum(e.slot_capacity), 0)::integer,
    greatest(104857600, coalesce(max(e.max_photos::bigint * 5242880 + e.max_videos::bigint * 52428800), 0))
  from private.entitlements e
  where internal.entitlement_usable(e.status, e.starts_at, e.ends_at)
    and (e.owner_id = p_owner or exists (select 1 from private.entitlement_members m
      where m.entitlement_id = e.id and m.member_id = p_owner))
    and exists(select 1 from private.current_account_access u where u.id=e.owner_id)
    and (e.source<>'retail_paid' or exists(select 1 from private.payments pay
      where pay.id=e.payment_id and pay.owner_id=e.owner_id and pay.status='complete'));
$$;
revoke all on function internal.package_capacity(uuid) from public, anon, authenticated, service_role;

-- Drafts: 5 plus 1 per post in the owner's packages.
create function internal.draft_allowance(p_owner uuid)
returns integer language sql stable security invoker set search_path = pg_catalog as $$
  select 5 + c.posts from internal.package_capacity(p_owner) c;
$$;
revoke all on function internal.draft_allowance(uuid) from public, anon, authenticated, service_role;

-- Storage follows the package, never a fixed account quota: room for every
-- post the owner can hold at full media size (live posts, drafts and up to 5
-- free events), i.e. (2 x package posts + 10) x the per-post media allowance.
create function internal.media_storage_allowance(p_owner uuid)
returns bigint language sql stable security invoker set search_path = pg_catalog as $$
  select (2 * c.posts + 10)::bigint * c.post_media_bytes from internal.package_capacity(p_owner) c;
$$;
revoke all on function internal.media_storage_allowance(uuid) from public, anon, authenticated, service_role;

-- The search projection is derived from the post row: visible only while live.
-- New approvals and approved edits both write it here, in their own commit.
create function internal.write_post_projection(p_post_id uuid)
returns void language plpgsql security invoker set search_path = pg_catalog as $$
declare post private.posts; price record; public_facets jsonb := '{}'::jsonb;
begin
  select * into post from private.posts p where p.id = p_post_id;
  select d.price_mode, d.price_cents into price from private.listing_details d where d.post_id = post.id;
  if post.kind = 'listing' then
    select coalesce(jsonb_object_agg(f.key, d.attributes->f.key), '{}'::jsonb) into public_facets
    from private.category_fields f join private.listing_details d on d.post_id = post.id
    where f.category_key = post.category_key and f.facet_kind is not null and d.attributes ? f.key;
  end if;
  insert into private.post_search_documents (post_id, kind, area, category_key, activity_key, province_id, city_id,
    locality_label, title, summary, price_mode, price_cents, published_at, visible_until, is_visible, facets)
  values (post.id, post.kind, post.area, post.category_key, post.activity_key, post.province_id, post.city_id,
    coalesce(post.locality_label, (select c.label from private.cities c where c.id = post.city_id)),
    post.title, left(coalesce(post.description, ''), 300), price.price_mode,
    case when price.price_mode = 'on_request' then null else price.price_cents end,
    post.published_at, post.visible_until, post.status = 'live', public_facets)
  on conflict (post_id) do update set kind = excluded.kind, area = excluded.area,
    category_key = excluded.category_key, activity_key = excluded.activity_key, province_id = excluded.province_id,
    city_id = excluded.city_id, locality_label = excluded.locality_label, title = excluded.title,
    summary = excluded.summary, price_mode = excluded.price_mode, price_cents = excluded.price_cents,
    published_at = excluded.published_at, visible_until = excluded.visible_until, is_visible = excluded.is_visible,
    facets = excluded.facets;
end;
$$;
revoke all on function internal.write_post_projection(uuid) from public, anon, authenticated, service_role;

-- Merge an approved edit copy into its live post (caller holds both row locks,
-- live post first). Content, details and media links are replaced in this
-- commit; publication time and funding window are unchanged.
create function internal.apply_post_edit(p_original_id uuid, p_edit_id uuid)
returns jsonb language plpgsql security invoker set search_path = pg_catalog as $$
declare original private.posts; edit private.posts; photo_limit integer; video_limit integer;
  detail jsonb; links jsonb; rev integer; price_only boolean;
begin
  select * into original from private.posts p where p.id = p_original_id;
  select * into edit from private.posts p where p.id = p_edit_id and p.edit_of = p_original_id;
  if original.status not in ('live', 'paused') then
    raise exception 'the live post is no longer published' using errcode = 'PT409';
  end if;
  if not exists (select 1 from private.current_account_access u where u.id = original.owner_id) then
    raise exception 'post owner is no longer eligible' using errcode = 'PT409';
  end if;
  price_only := internal.edit_is_price_only(original.id, edit.id);
  if price_only and internal.recent_price_change(original.id) then
    raise exception 'one price change per day; try again tomorrow' using errcode = 'PT429';
  end if;
  if not price_only and internal.approved_edit_count(original.id) >= internal.edit_allowance(original.id) then
    raise exception 'all edits for this post are used; a price-only change is still allowed' using errcode = 'PT409';
  end if;
  select f.max_photos, f.max_videos into photo_limit, video_limit
    from internal.post_funding(original.id) f where f.funded_until > statement_timestamp();
  if not found then raise exception 'funding or event window has ended' using errcode = 'PT409'; end if;
  -- Lock linked objects before reading their state, as linking and cleanup do.
  perform m.id from private.media_objects m
    where m.id in (select pm.object_id from private.post_media pm where pm.post_id = edit.id) order by m.id for update;
  if exists (select 1 from private.post_media pm join private.media_objects m on m.id = pm.object_id
      where pm.post_id = edit.id and m.state <> 'ready') then
    raise exception 'a linked upload is no longer available' using errcode = 'PT409';
  end if;
  if (select count(distinct pm.object_id) from private.post_media pm where pm.post_id = edit.id and pm.purpose <> 'video') > photo_limit
    or (select count(distinct pm.object_id) from private.post_media pm where pm.post_id = edit.id and pm.purpose = 'video') > video_limit then
    raise exception 'funded media allowance changed since submission' using errcode = 'PT409';
  end if;
  select coalesce(jsonb_agg(to_jsonb(pm)), '[]') into links from private.post_media pm where pm.post_id = edit.id;
  detail := case original.kind
      when 'listing' then (select to_jsonb(d) from private.listing_details d where d.post_id = edit.id)
      when 'business' then (select to_jsonb(d) from private.business_details d where d.post_id = edit.id)
      else (select to_jsonb(d) from private.event_details d where d.post_id = edit.id) end
    || jsonb_build_object('post_id', original.id);
  delete from private.posts where id = edit.id; -- with its details, links and queue claim
  update private.posts set category_key = edit.category_key, activity_key = edit.activity_key, title = edit.title,
    description = edit.description, province_id = edit.province_id, city_id = edit.city_id,
    locality_label = edit.locality_label, revision = revision + 1, content_updated_at = statement_timestamp()
  where id = original.id returning revision into rev;
  if original.kind = 'listing' then
    delete from private.listing_details where post_id = original.id;
    insert into private.listing_details select (jsonb_populate_record(null::private.listing_details, detail)).*;
  elsif original.kind = 'business' then
    delete from private.business_details where post_id = original.id;
    insert into private.business_details select (jsonb_populate_record(null::private.business_details, detail)).*;
  else
    delete from private.event_details where post_id = original.id;
    insert into private.event_details select (jsonb_populate_record(null::private.event_details, detail)).*;
  end if;
  delete from private.post_media where post_id = original.id;
  insert into private.post_media
  select (jsonb_populate_record(null::private.post_media, l || jsonb_build_object('post_id', original.id))).*
  from jsonb_array_elements(links) l;
  perform internal.write_post_projection(original.id);
  return jsonb_build_object('revision', rev, 'price_only', price_only);
end;
$$;
revoke all on function internal.apply_post_edit(uuid, uuid) from public, anon, authenticated, service_role;

-- Staff: approve or reject the exact revision that was reviewed, holding the
-- current queue claim for it (moderation-queues.sql). Approval publishes (or,
-- for an edit, merges) and writes the search projection in the same commit.
create function internal.moderate_post(p_post_id uuid, p_expected_revision integer, p_decision text, p_reason text,
  p_claim_generation text, p_claim_nonce uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare
  actor uuid := internal.staff_actor('post:moderate');
  post private.posts;
  original_id uuid;
  funded_until timestamptz;
  photo_limit integer;
  video_limit integer;
  rev integer;
  merged jsonb;
begin
  perform internal.assert_post_revision(p_expected_revision);
  if p_decision is null or p_decision not in ('approve', 'reject')
    or (p_decision = 'reject' and length(btrim(coalesce(p_reason, ''))) not between 5 and 500) then
    raise exception 'decision and, for rejections, a reason are required' using errcode = '22023';
  end if;
  -- An edit locks its live post before the copy, like every owner command.
  select p.edit_of into original_id from private.posts p where p.id = p_post_id;
  if original_id is not null then
    perform 1 from private.posts p where p.id = original_id for update;
  end if;
  select * into post from private.posts p where p.id = p_post_id for update;
  if not found or post.status <> 'pending_moderation' or post.edit_of is distinct from original_id then
    raise exception 'post is not awaiting moderation' using errcode = '22023';
  end if;
  actor := internal.staff_actor('post:moderate'); -- authority after any lock wait
  if post.owner_id = actor then raise exception 'self-review is not allowed' using errcode = '42501'; end if;
  perform internal.consume_queue_claim('post', post.id, actor, p_claim_generation, p_claim_nonce);
  if post.revision <> p_expected_revision then raise exception 'post changed since review' using errcode = 'PT409'; end if;
  if p_decision = 'reject' then
    update private.post_activations set released_at = statement_timestamp(), release_reason = 'moderation'
      where post_id = post.id and released_at is null;
    update private.posts set status = 'rejected', status_reason = btrim(p_reason), revision = revision + 1
      where id = post.id;
  elsif original_id is not null then
    merged := internal.apply_post_edit(original_id, post.id);
    rev := (merged->>'revision')::integer;
  else
    if not exists(select 1 from private.current_account_access u where u.id=post.owner_id) then
      raise exception 'post owner is no longer eligible' using errcode='PT409';
    end if;
    select f.funded_until, f.max_photos, f.max_videos into funded_until, photo_limit, video_limit
      from internal.post_funding(post.id) f;
    if funded_until is null or funded_until <= statement_timestamp() then
      raise exception 'funding or event window has ended' using errcode = 'PT409';
    end if;
    if (select count(distinct pm.object_id) from private.post_media pm where pm.post_id=post.id and pm.purpose<>'video')>photo_limit
      or (select count(distinct pm.object_id) from private.post_media pm where pm.post_id=post.id and pm.purpose='video')>video_limit then
      raise exception 'funded media allowance changed since submission' using errcode='PT409';
    end if;
    update private.posts set status = 'live', published_at = statement_timestamp(), visible_until = funded_until,
      revision = revision + 1 where id = post.id;
    perform internal.write_post_projection(post.id);
  end if;
  perform internal.staff_actor('post:moderate'); -- authority after claim-row and media waits
  insert into private.moderation_log (post_id, edit_id, staff_id, decision, post_revision, reason, price_only)
  values (coalesce(original_id, post.id), case when original_id is not null then post.id end, actor, p_decision,
    p_expected_revision, nullif(btrim(coalesce(p_reason, '')), ''), coalesce((merged->>'price_only')::boolean, false));
  if original_id is not null then
    return jsonb_build_object('id', post.id, 'edit_of', original_id,
      'status', case when p_decision = 'approve' then 'merged' else 'rejected' end, 'post_revision', rev,
      'price_only', coalesce((merged->>'price_only')::boolean, false));
  end if;
  return jsonb_build_object('id', post.id, 'status', case when p_decision = 'approve' then 'live' else 'rejected' end,
    'visible_until', funded_until);
end;
$$;
revoke all on function internal.moderate_post(uuid, integer, text, text, text, uuid) from public, anon, authenticated, service_role;
grant execute on function internal.moderate_post(uuid, integer, text, text, text, uuid) to authenticated;
create function api.moderate_post(p_post_id uuid, p_expected_revision integer, p_decision text,
  p_claim_generation text, p_claim_nonce uuid, p_reason text default null)
returns jsonb language sql security invoker set search_path = pg_catalog as $$
  select internal.moderate_post(p_post_id, p_expected_revision, p_decision, p_reason, p_claim_generation, p_claim_nonce);
$$;
revoke all on function api.moderate_post(uuid, integer, text, text, uuid, text) from public, anon, authenticated, service_role;
grant execute on function api.moderate_post(uuid, integer, text, text, uuid, text) to authenticated;

-- Owner: take a live post down (pause), mark it sold (listings) or archive it.
-- The post leaves search immediately and frees its paid slot.
create function internal.set_post_state(p_post_id uuid, p_expected_revision integer, p_action text)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare actor uuid := internal.price_draft_actor(); post private.posts; next_status text; rev integer;
begin
  perform internal.assert_post_revision(p_expected_revision);
  next_status := case p_action when 'pause' then 'paused' when 'sold' then 'sold' when 'archive' then 'archived' end;
  if next_status is null then raise exception 'unknown action' using errcode = '22023'; end if;
  select * into post from private.posts p where p.id = p_post_id and p.owner_id = actor for update;
  if not found then raise exception 'post not found' using errcode = '22023'; end if;
  if post.status not in ('live', 'paused') or (p_action = 'sold' and post.kind <> 'listing')
    or (p_action = 'pause' and post.status <> 'live') then
    raise exception 'action not available for this post' using errcode = '22023';
  end if;
  if post.revision <> p_expected_revision then raise exception 'post changed' using errcode = 'PT409'; end if;
  if next_status in ('sold', 'archived') then
    delete from private.posts where edit_of = post.id; -- an edit of a finished post is moot
  end if;
  update private.posts set status = next_status, revision = revision + 1 where id = post.id returning revision into rev;
  update private.post_search_documents set is_visible = false where post_id = post.id;
  update private.post_activations set released_at = statement_timestamp(),
    release_reason = case when p_action = 'sold' then 'sold' else 'owner' end
  where post_id = post.id and released_at is null;
  perform internal.price_draft_actor(); -- final live owner/session check after all waits
  return jsonb_build_object('id', post.id, 'status', next_status, 'revision', rev);
end;
$$;
revoke all on function internal.set_post_state(uuid, integer, text) from public, anon, authenticated, service_role;
grant execute on function internal.set_post_state(uuid, integer, text) to authenticated;
create function api.set_post_state(p_post_id uuid, p_expected_revision integer, p_action text)
returns jsonb language sql security invoker set search_path = pg_catalog as $$
  select internal.set_post_state(p_post_id, p_expected_revision, p_action);
$$;
revoke all on function api.set_post_state(uuid, integer, text) from public, anon, authenticated, service_role;
grant execute on function api.set_post_state(uuid, integer, text) to authenticated;

-- Owner: start an edit of a live post. The copy holds the same content,
-- details and media links and is then changed with the normal draft commands
-- and submit_post. Posts columns are copied explicitly (identity and content);
-- lifecycle columns start fresh. Detail and link rows are copied whole.
create function internal.create_post_edit(p_post_id uuid, p_expected_revision integer)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare actor uuid := internal.price_draft_actor(); original private.posts; edit_id uuid := pg_catalog.gen_random_uuid();
begin
  perform internal.assert_post_revision(p_expected_revision);
  select * into original from private.posts p where p.id = p_post_id and p.owner_id = actor for update;
  if not found or original.edit_of is not null then raise exception 'post not found' using errcode = '22023'; end if;
  if original.status <> 'live' then
    raise exception 'only live posts are edited through review' using errcode = '22023';
  end if;
  if original.revision <> p_expected_revision then raise exception 'post changed' using errcode = 'PT409'; end if;
  if exists (select 1 from private.posts e where e.edit_of = original.id) then
    raise exception 'this post already has an edit waiting' using errcode = 'PT409';
  end if;
  insert into private.posts (id, owner_id, kind, area, category_key, activity_key, title, description,
    province_id, city_id, locality_label, edit_of)
  values (edit_id, original.owner_id, original.kind, original.area, original.category_key, original.activity_key,
    original.title, original.description, original.province_id, original.city_id, original.locality_label, original.id);
  if original.kind = 'listing' then
    insert into private.listing_details select (jsonb_populate_record(null::private.listing_details,
      to_jsonb(d) || jsonb_build_object('post_id', edit_id))).* from private.listing_details d where d.post_id = original.id;
  elsif original.kind = 'business' then
    insert into private.business_details select (jsonb_populate_record(null::private.business_details,
      to_jsonb(d) || jsonb_build_object('post_id', edit_id))).* from private.business_details d where d.post_id = original.id;
  else
    insert into private.event_details select (jsonb_populate_record(null::private.event_details,
      to_jsonb(d) || jsonb_build_object('post_id', edit_id))).* from private.event_details d where d.post_id = original.id;
  end if;
  perform m.id from private.media_objects m
    where m.id in (select pm.object_id from private.post_media pm where pm.post_id = original.id) order by m.id for update;
  insert into private.post_media select (jsonb_populate_record(null::private.post_media,
    to_jsonb(pm) || jsonb_build_object('post_id', edit_id))).* from private.post_media pm where pm.post_id = original.id;
  perform internal.price_draft_actor(); -- final live owner/session check after all waits
  return jsonb_build_object('id', edit_id, 'edit_of', original.id, 'status', 'draft', 'revision', 1,
    'edits_remaining', greatest(0, internal.edit_allowance(original.id) - internal.approved_edit_count(original.id)),
    'price_change_always_allowed', true);
end;
$$;
revoke all on function internal.create_post_edit(uuid, integer) from public, anon, authenticated, service_role;
grant execute on function internal.create_post_edit(uuid, integer) to authenticated;
create function api.create_post_edit(p_post_id uuid, p_expected_revision integer)
returns jsonb language sql security invoker set search_path = pg_catalog as $$
  select internal.create_post_edit(p_post_id, p_expected_revision);
$$;
revoke all on function api.create_post_edit(uuid, integer) from public, anon, authenticated, service_role;
grant execute on function api.create_post_edit(uuid, integer) to authenticated;

-- Owner: discard an edit (draft, waiting or rejected). The live post is unchanged.
create function internal.discard_post_edit(p_edit_id uuid, p_expected_revision integer)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare actor uuid := internal.price_draft_actor(); original_id uuid; edit private.posts;
begin
  perform internal.assert_post_revision(p_expected_revision);
  select p.edit_of into original_id from private.posts p where p.id = p_edit_id and p.owner_id = actor;
  if original_id is null then raise exception 'edit not found' using errcode = '22023'; end if;
  perform 1 from private.posts p where p.id = original_id for update;
  select * into edit from private.posts p where p.id = p_edit_id and p.owner_id = actor and p.edit_of = original_id for update;
  if not found then raise exception 'edit not found' using errcode = '22023'; end if;
  if edit.revision <> p_expected_revision then raise exception 'edit changed' using errcode = 'PT409'; end if;
  delete from private.posts where id = edit.id;
  perform internal.price_draft_actor(); -- final live owner/session check after all waits
  return jsonb_build_object('id', edit.id, 'edit_of', original_id, 'status', 'discarded');
end;
$$;
revoke all on function internal.discard_post_edit(uuid, integer) from public, anon, authenticated, service_role;
grant execute on function internal.discard_post_edit(uuid, integer) to authenticated;
create function api.discard_post_edit(p_edit_id uuid, p_expected_revision integer)
returns jsonb language sql security invoker set search_path = pg_catalog as $$
  select internal.discard_post_edit(p_edit_id, p_expected_revision);
$$;
revoke all on function api.discard_post_edit(uuid, integer) from public, anon, authenticated, service_role;
grant execute on function api.discard_post_edit(uuid, integer) to authenticated;

-- Owner: delete a post (DEC-28). Its slot is freed at once; the activation
-- history is kept, so the package's re-post allowance is not reset. Its photos
-- and videos stay reusable for 24 hours. Not while an account legal hold is active.
create function internal.delete_post(p_post_id uuid, p_expected_revision integer)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare actor uuid := internal.price_draft_actor(); post private.posts;
begin
  perform internal.assert_post_revision(p_expected_revision);
  -- Match hold placement/closure ordering: account subject before post rows.
  perform internal.lock_evidence_subject(actor);
  select * into post from private.posts p where p.id = p_post_id and p.owner_id = actor for update;
  if not found or post.edit_of is not null then raise exception 'post not found' using errcode = '22023'; end if;
  if post.revision <> p_expected_revision then raise exception 'post changed' using errcode = 'PT409'; end if;
  if exists (select 1 from private.legal_holds h where h.subject_id = actor and h.released_at is null) then
    raise exception 'posts cannot be deleted during a legal hold' using errcode = 'PT409';
  end if;
  delete from private.posts where id = post.id; -- with its edit copy, links and queue claim
  perform internal.price_draft_actor(); -- final live owner/session check after all waits
  return jsonb_build_object('id', post.id, 'status', 'deleted');
end;
$$;
revoke all on function internal.delete_post(uuid, integer) from public, anon, authenticated, service_role;
grant execute on function internal.delete_post(uuid, integer) to authenticated;
create function api.delete_post(p_post_id uuid, p_expected_revision integer)
returns jsonb language sql security invoker set search_path = pg_catalog as $$
  select internal.delete_post(p_post_id, p_expected_revision);
$$;
revoke all on function api.delete_post(uuid, integer) from public, anon, authenticated, service_role;
grant execute on function api.delete_post(uuid, integer) to authenticated;

-- Server job (DEC-28/29), run hourly. Nothing is kept indefinitely:
--  * live posts past visible_until become expired and release their slot;
--  * owners get a notice at expiry and 7 and 21 days later (renew offers), and
--    a warning 45 days into an untouched draft, rejected or paused post;
--  * expired, sold and archived posts are deleted 30 days after that status,
--    untouched drafts, rejected and paused posts (and edit copies) after 60
--    days; their photos and videos follow 24 hours later via the media sweep.
-- Posts awaiting review are never touched; owners under a legal hold are skipped.
create function internal.run_post_lifecycle(p_limit integer)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare n_expired integer := 0; n_notices integer := 0; n_deleted integer := 0;
  r record; post private.posts; changed integer;
begin
  if p_limit is null or p_limit not between 1 and 5000 then
    raise exception 'limit 1 to 5000' using errcode = '22023';
  end if;
  -- Candidates are unlocked. Take the shared hold/closure subject guard before
  -- locking a post, then re-evaluate all mutable eligibility under those locks.
  for r in
    select p.id,p.owner_id from private.posts p
    where p.status='live' and p.visible_until<=clock_timestamp()
      and not exists(select 1 from private.legal_holds h where h.subject_id=p.owner_id and h.released_at is null)
    order by p.visible_until,p.id limit p_limit
  loop
    if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(r.owner_id::text,2408)) then continue; end if;
    select * into post from private.posts p where p.id=r.id and p.status='live'
      and p.visible_until<=clock_timestamp() for update skip locked;
    if not found or exists(select 1 from private.legal_holds h where h.subject_id=r.owner_id and h.released_at is null) then continue; end if;
    update private.posts set status='expired',status_reason='Visibility period ended',revision=revision+1 where id=post.id;
    update private.post_search_documents set is_visible=false where post_id=post.id;
    update private.post_activations set released_at=clock_timestamp(),release_reason='expired'
      where post_id=post.id and released_at is null;
    n_expired:=n_expired+1;
  end loop;
  -- At most p_limit new notices per invocation; old dedupe rows do not starve
  -- later notices. Lock/recheck each post so a concurrent renewal invalidates
  -- the captured revision before its stale reminder can be queued.
  for r in
    select n.* from (
      select 'post_expired'::text as kind,p.id,p.owner_id,p.revision,p.status_changed_at as due_at,
        'post_expired:'||p.id||':'||floor(extract(epoch from p.status_changed_at))::bigint as dedupe_key
      from private.posts p where p.status='expired'
      union all
      select 'post_expiry_reminder',p.id,p.owner_id,p.revision,p.status_changed_at+make_interval(days=>d.day),
        'post_expiry_reminder:'||p.id||':'||d.day||':'||floor(extract(epoch from p.status_changed_at))::bigint
      from private.posts p cross join (values(7),(21)) d(day)
      where p.status='expired' and p.status_changed_at<=clock_timestamp()-make_interval(days=>d.day)
      union all
      select 'draft_deletion_warning',p.id,p.owner_id,p.revision,greatest(p.content_updated_at,p.status_changed_at)+interval '45 days',
        'draft_deletion_warning:'||p.id||':'||floor(extract(epoch from greatest(p.content_updated_at,p.status_changed_at)))::bigint
      from private.posts p where p.status in('draft','rejected','paused')
        and greatest(p.content_updated_at,p.status_changed_at)<=clock_timestamp()-interval '45 days'
    ) n where not exists(select 1 from private.outbox_events o where o.dedupe_key=n.dedupe_key)
      and not exists(select 1 from private.legal_holds h where h.subject_id=n.owner_id and h.released_at is null)
    order by n.due_at,n.id,n.kind,n.dedupe_key limit p_limit
  loop
    if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(r.owner_id::text,2408)) then continue; end if;
    select * into post from private.posts p where p.id=r.id and p.revision=r.revision for update skip locked;
    if not found or exists(select 1 from private.legal_holds h where h.subject_id=r.owner_id and h.released_at is null) then continue; end if;
    insert into private.outbox_events(kind,subject_id,owner_id,dedupe_key) values(r.kind,r.id,r.owner_id,r.dedupe_key)
      on conflict(dedupe_key) do nothing;
    get diagnostics changed=row_count; n_notices:=n_notices+changed;
  end loop;
  for r in
    select p.id,p.owner_id from private.posts p
    where ((p.status in('expired','sold','archived') and p.status_changed_at<=clock_timestamp()-interval '30 days')
      or (p.status in('draft','rejected','paused') and greatest(p.content_updated_at,p.status_changed_at)<=clock_timestamp()-interval '60 days'))
      and not exists(select 1 from private.legal_holds h where h.subject_id=p.owner_id and h.released_at is null)
      and not exists(select 1 from private.posts e where e.edit_of=p.id and (e.status='pending_moderation' or greatest(e.content_updated_at,e.status_changed_at)>clock_timestamp()-interval '60 days'))
    order by p.status_changed_at,p.id limit p_limit
  loop
    if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(r.owner_id::text,2408)) then continue; end if;
    select * into post from private.posts p where p.id=r.id and
      ((p.status in('expired','sold','archived') and p.status_changed_at<=clock_timestamp()-interval '30 days')
       or (p.status in('draft','rejected','paused') and greatest(p.content_updated_at,p.status_changed_at)<=clock_timestamp()-interval '60 days'))
      for update skip locked;
    if not found or exists(select 1 from private.legal_holds h where h.subject_id=r.owner_id and h.released_at is null)
      or exists(select 1 from private.posts e where e.edit_of=post.id and (e.status='pending_moderation' or greatest(e.content_updated_at,e.status_changed_at)>clock_timestamp()-interval '60 days')) then continue; end if;
    insert into private.outbox_events(kind,subject_id,owner_id,dedupe_key)
      values('post_deleted',post.id,post.owner_id,'post_deleted:'||post.id) on conflict(dedupe_key) do nothing;
    delete from private.posts where id=post.id;
    n_deleted:=n_deleted+1;
  end loop;
  return jsonb_build_object('expired',n_expired,'notices',n_notices,'deleted',n_deleted);
end;
$$;
revoke all on function internal.run_post_lifecycle(integer) from public, anon, authenticated, service_role;
grant execute on function internal.run_post_lifecycle(integer) to service_role;
create function api.run_post_lifecycle(p_limit integer)
returns jsonb language sql security invoker set search_path = pg_catalog as $$
  select internal.run_post_lifecycle(p_limit);
$$;
revoke all on function api.run_post_lifecycle(integer) from public, anon, authenticated, service_role;
grant execute on function api.run_post_lifecycle(integer) to service_role;

-- One current eligibility relation for public browse and detail. Projection
-- flags alone cannot extend funding or survive account/membership revocation.
-- This private invoker view has no browser/service table grants.
create view private.public_eligible_posts with (security_invoker=true) as
  select p.id
  from private.posts p join private.current_account_access u on u.id=p.owner_id
  where p.status='live' and p.published_at<=statement_timestamp() and p.visible_until>statement_timestamp()
    and ((p.kind='event' and exists(select 1 from private.event_details e where e.post_id=p.id and e.ends_at>statement_timestamp()))
      or (p.kind<>'event' and exists(
        select 1 from private.post_activations a join private.entitlements e on e.id=a.entitlement_id
        join private.current_account_access funding_owner on funding_owner.id=e.owner_id
        where a.post_id=p.id and a.owner_id=p.owner_id and a.released_at is null
          and internal.entitlement_usable(e.status,e.starts_at,e.ends_at)
          and (e.area is null or e.area=p.area)
          and (e.owner_id=p.owner_id or exists(select 1 from private.entitlement_members m
            where m.entitlement_id=e.id and m.member_id=p.owner_id))
          and (select count(distinct pm.object_id) from private.post_media pm where pm.post_id=p.id and pm.purpose<>'video')<=e.max_photos
          and (select count(distinct pm.object_id) from private.post_media pm where pm.post_id=p.id and pm.purpose='video')<=e.max_videos
          and (e.source<>'retail_paid' or exists(select 1 from private.payments pay
            where pay.id=e.payment_id and pay.owner_id=e.owner_id and pay.status='complete')))));
revoke all on private.public_eligible_posts from public,anon,authenticated,service_role;

-- Public detail: current eligibility, visible projection and both time windows.
create function internal.get_public_post(p_id uuid)
returns jsonb language sql stable security definer set search_path = pg_catalog as $$
  select jsonb_build_object('id', p.id, 'kind', p.kind, 'area', p.area, 'category', p.category_key,
    'activity', p.activity_key, 'title', p.title, 'description', p.description, 'province', p.province_id,
    'city', p.city_id, 'locality', d.locality_label, 'price_mode', d.price_mode, 'price_cents', d.price_cents::text,
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
revoke all on function internal.get_public_post(uuid) from public, anon, authenticated, service_role;
grant execute on function internal.get_public_post(uuid) to anon, authenticated;
create function api.get_public_post(p_id uuid)
returns jsonb language sql stable security invoker set search_path = pg_catalog as $$
  select internal.get_public_post(p_id);
$$;
revoke all on function api.get_public_post(uuid) from public, anon, authenticated, service_role;
grant execute on function api.get_public_post(uuid) to anon, authenticated;

-- Server sweep: abandoned intents (> 1 hour), rejected uploads and finished
-- uploads that no post has used for 24 hours become cleanup_required.
-- An object is in use while any row in any table with a foreign key to
-- media_objects points at it (post media today; avatars, logos and report
-- attachments later), so a new consumer is protected without changing cleanup.
-- Consumers must reference objects through a single-column foreign key and lock
-- the object row before linking; anything else fails closed (treated as in use).
create function internal.media_object_in_use(p_object_id uuid)
returns boolean language plpgsql stable security invoker set search_path = pg_catalog as $$
declare fk record; used boolean;
begin
  for fk in
    select c.conrelid::regclass::text as rel, c.conkey, n.nspname as schema_name, r.relname as table_name
    from pg_catalog.pg_constraint c
    join pg_catalog.pg_class r on r.oid = c.conrelid
    join pg_catalog.pg_namespace n on n.oid = r.relnamespace
    where c.contype = 'f' and c.confrelid = 'private.media_objects'::regclass
  loop
    if cardinality(fk.conkey) <> 1 then return true; end if;
    execute format('select exists (select 1 from %I.%I where %I = $1)', fk.schema_name, fk.table_name,
      (select a.attname from pg_catalog.pg_attribute a
        where a.attrelid = fk.rel::regclass and a.attnum = fk.conkey[1]))
      into used using p_object_id;
    if used then return true; end if;
  end loop;
  return false;
end;
$$;
revoke all on function internal.media_object_in_use(uuid) from public, anon, authenticated, service_role;

create function internal.claim_media_cleanup(p_limit integer)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare rows jsonb := '[]'::jsonb; obj private.media_objects; token uuid;
begin
  if p_limit is null or p_limit not between 1 and 500 then raise exception 'limit 1 to 500' using errcode = '22023'; end if;
  for obj in
    select m.* from private.media_objects m
    where (m.state = 'intent' and m.created_at < statement_timestamp() - interval '1 hour')
       or m.state = 'rejected'
       or (m.state = 'ready' and coalesce(greatest(m.created_at, m.unlinked_at), m.created_at)
             < statement_timestamp() - interval '24 hours'
           and not internal.media_object_in_use(m.id))
       or (m.state = 'cleanup_required' and coalesce(m.cleanup_lease_until,'-infinity'::timestamptz) <= statement_timestamp())
    order by m.created_at limit p_limit
    for update skip locked
  loop
    -- A separate statement sees links committed before this object lock was acquired.
    if internal.media_object_in_use(obj.id) then continue; end if;
    token := pg_catalog.gen_random_uuid();
    update private.media_objects set state='cleanup_required',cleanup_token=token,
      cleanup_lease_until=statement_timestamp()+interval '5 minutes',cleanup_attempt=cleanup_attempt+1
      where id=obj.id;
    rows := rows || jsonb_build_array(jsonb_build_object('object_id',obj.id,'object_key',obj.object_key,
      'claim_token',token,'lease_until',statement_timestamp()+interval '5 minutes'));
  end loop;
  return rows;
end;
$$;
revoke all on function internal.claim_media_cleanup(integer) from public, anon, authenticated, service_role;
grant execute on function internal.claim_media_cleanup(integer) to service_role;
create function api.claim_media_cleanup(p_limit integer)
returns jsonb language sql security invoker set search_path = pg_catalog as $$
  select internal.claim_media_cleanup(p_limit);
$$;
revoke all on function api.claim_media_cleanup(integer) from public, anon, authenticated, service_role;
grant execute on function api.claim_media_cleanup(integer) to service_role;

-- Server: record deletion only after the object store confirms it.
create function internal.mark_media_deleted(p_object_id uuid,p_claim_token uuid)
returns boolean language plpgsql security definer set search_path = pg_catalog as $$
begin
  if p_claim_token is null then raise exception 'cleanup claim token required' using errcode='22023'; end if;
  if exists(select 1 from private.media_objects where id=p_object_id and state='deleted' and cleanup_token=p_claim_token) then return true; end if;
  update private.media_objects set state = 'deleted', deleted_at = statement_timestamp()
  where id = p_object_id and state = 'cleanup_required' and cleanup_token=p_claim_token
    and cleanup_lease_until>statement_timestamp();
  if not found then raise exception 'object is not awaiting deletion' using errcode = '22023'; end if;
  return true;
end;
$$;
revoke all on function internal.mark_media_deleted(uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function internal.mark_media_deleted(uuid,uuid) to service_role;
create function api.mark_media_deleted(p_object_id uuid,p_claim_token uuid)
returns boolean language sql security invoker set search_path = pg_catalog as $$
  select internal.mark_media_deleted(p_object_id,p_claim_token);
$$;
revoke all on function api.mark_media_deleted(uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function api.mark_media_deleted(uuid,uuid) to service_role;

-- Replaces the BF-07 reversal so a refund or chargeback also takes the funded
-- posts off the site in the same commit.
create or replace function internal.reverse_payment(p_payment_id uuid, p_kind text, p_reason text)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare pay private.payments; released integer := 0; v_post_ids uuid[]; payment_owner uuid;
begin
  if p_kind not in ('refunded', 'chargeback') or length(btrim(coalesce(p_reason, ''))) not between 5 and 500 then
    raise exception 'reversal kind and audit reason required' using errcode = '22023';
  end if;
  select p.owner_id into payment_owner from private.payments p where p.id=p_payment_id;
  if payment_owner is not null then perform internal.lock_evidence_subject(payment_owner); end if;
  select * into pay from private.payments p where p.id = p_payment_id for update;
  if not found or pay.status <> 'complete' then
    raise exception 'only completed payments can be reversed' using errcode = '22023';
  end if;
  begin
    perform e.id from private.entitlements e where e.payment_id=pay.id order by e.id for update nowait;
    perform p.id from private.posts p where p.id=pay.target_post_id or p.id in
      (select a.post_id from private.post_activations a join private.entitlements e on e.id=a.entitlement_id
        where e.payment_id=pay.id and a.released_at is null)
      order by p.id for update of p nowait;
  exception when lock_not_available then
    raise exception 'funded posts are busy; retry reversal' using errcode='PT409';
  end;
  update private.payments set status = p_kind, fulfillment_status='reversed', status_changed_at = statement_timestamp() where id = pay.id;
  update private.entitlements set status = 'revoked', revoked_reason = 'payment_' || p_kind where payment_id = pay.id;
  with released_rows as (
    update private.post_activations a set released_at = statement_timestamp(), release_reason = 'payment_reversed'
    from private.entitlements e where e.id = a.entitlement_id and e.payment_id = pay.id and a.released_at is null
    returning a.post_id
  )
  select coalesce(array_agg(post_id), '{}') into v_post_ids from released_rows;
  released := cardinality(v_post_ids);
  update private.posts set status = 'expired', status_reason = 'Payment ' || p_kind, revision = revision + 1
    where id = any (v_post_ids) and status in ('live', 'pending_moderation');
  update private.post_search_documents set is_visible = false where post_id = any (v_post_ids);
  update private.post_addon_windows set revoked_at = statement_timestamp() where payment_id = pay.id and revoked_at is null;
  insert into private.outbox_events (kind, subject_id, owner_id, dedupe_key)
  values ('payment_reversed', pay.id, pay.owner_id, 'payment_reversed:' || pay.id);
  return jsonb_build_object('status', p_kind, 'released_activations', released);
end;
$$;
