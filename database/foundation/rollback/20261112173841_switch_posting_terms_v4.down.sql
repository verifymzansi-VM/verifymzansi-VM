-- Reviewed rollback for updates/20261112173841_switch_posting_terms_v4.sql.
-- Not part of the replay. Run it only if that update must be undone, after the
-- owner has decided so, and together with a website release that names
-- posting-v3 active and sells the old plans again.
--
-- It restores internal.set_post_media as it was before the switch, makes
-- posting-v3 current again and puts back on sale exactly the plan
-- versions the switch took off sale (those recorded in private.plan_sale_pauses
-- with the same retirement time), then drops that record table. Catalogue rows
-- are otherwise immutable (internal.catalogue_version_guard), so the guard
-- trigger is switched off for that one statement inside this transaction.
-- Acceptances of posting-v4 stay as records; members accept posting-v3 again.
--
-- It refuses (55000) when posting-v4 is not current, or when a plan published
-- after the switch is on sale (undo that later update first). Run before the
-- update, or a second time, it changes nothing.
begin;
set local lock_timeout='5s';

do $$
declare current_version text;
begin
  if to_regclass('private.plan_sale_pauses') is null then
    return; -- the switch is not applied (or already rolled back)
  end if;
  select c.version into current_version from private.posting_terms_current c where c.singleton for update;
  if current_version is distinct from 'posting-v4' then
    raise exception 'rollback precondition: current posting terms are %, expected posting-v4',
      coalesce(current_version,'missing') using errcode='55000';
  end if;
  if not exists(select 1 from private.posting_terms_versions v where v.version='posting-v3'
      and v.document_hash='p2X2YRoaYDOwYDtYhTiFcznVghgyGzRmTJ6BexfhkQE') then
    raise exception 'rollback precondition: posting-v3 is missing' using errcode='55000';
  end if;
  lock table private.plan_versions in share row exclusive mode;
  if exists(select 1 from private.plan_versions v where v.is_public and v.retired_at is null) then
    raise exception 'rollback precondition: plans published after the switch are on sale; undo that update first'
      using errcode='55000';
  end if;
  if exists(select 1 from private.plan_sale_pauses s join private.plan_versions v on v.id=s.plan_version_id
      where v.retired_at is distinct from s.retired_at) then
    raise exception 'rollback precondition: a paused plan was changed after the switch' using errcode='55000';
  end if;

  alter table private.plan_versions disable trigger plan_versions_immutable;
  update private.plan_versions v set retired_at=null
    from private.plan_sale_pauses s
    where s.plan_version_id=v.id and v.retired_at=s.retired_at and s.reason='posting_terms_v4_switch';
  alter table private.plan_versions enable trigger plan_versions_immutable;

  update private.posting_terms_current set version='posting-v3' where singleton;
  drop table private.plan_sale_pauses;
end$$;

-- The media allowance of drafts without a slot, as before the switch.
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

do $$begin
  if to_regclass('private.plan_sale_pauses') is not null then
    raise exception 'the switch record was not removed';
  end if;
end$$;
commit;
