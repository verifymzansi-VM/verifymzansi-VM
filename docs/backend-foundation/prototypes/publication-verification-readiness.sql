-- Publication verification readiness only. Guarded local foundation module.
-- Posting-term/version/document binding and profile/retention policy remain separate.
do $publication_verification_readiness$
begin

create function internal.assert_posting_verification_ready(p_post_id uuid,p_staff boolean)
returns void language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare actor uuid; owner uuid; ready boolean;
begin
  if p_staff is null then raise exception 'caller context required' using errcode='22023'; end if;
  actor:=case when p_staff then internal.staff_actor('post:moderate') else internal.price_draft_actor() end;
  select p.owner_id into owner from private.posts p where p.id=p_post_id;
  ready:=internal.current_verified_identity(owner) is not null;
  -- No new verification/evidence locks beneath post/media locks. Read canonical
  -- current facts and rederive the real caller before a data-dependent refusal.
  actor:=case when p_staff then internal.staff_actor('post:moderate') else internal.price_draft_actor() end;
  if owner is null then raise exception 'post unavailable' using errcode='22023'; end if;
  if (not p_staff and owner<>actor) or (p_staff and owner=actor) then
    raise exception 'caller cannot publish this post' using errcode='42501';
  end if;
  if not ready then
    raise exception 'complete identity verification before posting' using errcode='42501',
      detail='posting_verification_required';
  end if;
end;
$$;
revoke all on function internal.assert_posting_verification_ready(uuid,boolean)
  from public,anon,authenticated,service_role;

create function internal.get_owner_verification_readiness()
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.price_draft_actor(); result jsonb;
begin
  with facts as materialized (
    select internal.current_verified_identity(actor) is not null as verified,
      exists(select 1 from private.verification_phone_proofs p
        where p.owner_id=actor and p.revoked_at is null) as phone,
      exists(select 1 from private.verification_localities l
        where l.owner_id=actor) as locality
  )
  select jsonb_build_object(
    'verification_ready',f.verified and f.phone and f.locality,
    'phone_verified',f.phone,'locality_confirmed',f.locality
  ) into result from facts f;
  -- Canonical readiness is VOLATILE; the conservative conjunction guarantees
  -- the DTO implication even across concurrent proof transitions. It is a
  -- current observation, never permission for a later submit command.
  perform internal.price_draft_actor();
  return result;
end;
$$;
revoke all on function internal.get_owner_verification_readiness()
  from public,anon,authenticated,service_role;
grant execute on function internal.get_owner_verification_readiness() to authenticated;
create function api.get_owner_verification_readiness()
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.get_owner_verification_readiness();
$$;
revoke all on function api.get_owner_verification_readiness()
  from public,anon,authenticated,service_role;
grant execute on function api.get_owner_verification_readiness() to authenticated;

create or replace function internal.submit_post(p_post_id uuid, p_expected_revision integer)
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
  perform internal.price_draft_actor();
  perform internal.assert_post_contacts_ready(post.id,false);
  perform internal.assert_posting_verification_ready(post.id,false);
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
    perform internal.price_draft_actor(); -- fresh authority before quota or duplicate errors
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
  if post.kind='event' then
    perform internal.assert_event_duplicate_absent(post.id,false);
    if post.edit_of is not null and not exists(
      select 1 from internal.post_funding(post.edit_of) f where f.funded_until>clock_timestamp()) then
      raise exception 'funding or event window has ended' using errcode='PT409';
    end if;
  end if;
  update private.posts set status = 'pending_moderation', submitted_at = statement_timestamp(),
    status_reason = null, revision = revision + 1
  where id = post.id returning revision into rev;
  perform internal.assert_post_contacts_ready(post.id,false);
  perform internal.assert_posting_verification_ready(post.id,false);
  perform internal.price_draft_actor(); -- final live owner/session check after all waits
  return jsonb_build_object('id', post.id, 'status', 'pending_moderation', 'revision', rev);
end;
$$;

create or replace function internal.apply_post_edit(p_original_id uuid, p_edit_id uuid)
returns jsonb language plpgsql security invoker set search_path = pg_catalog as $$
declare original private.posts; edit private.posts; photo_limit integer; video_limit integer;
  detail jsonb; links jsonb; rev integer; price_only boolean; selected_channels text[];
  old_event_until timestamptz; new_event_until timestamptz;
begin
  select * into original from private.posts p where p.id = p_original_id;
  select * into edit from private.posts p where p.id = p_edit_id and p.edit_of = p_original_id;
  if original.kind='event' then
    select e.ends_at into old_event_until from private.event_details e where e.post_id=original.id;
    select e.ends_at into new_event_until from private.event_details e where e.post_id=edit.id;
    if old_event_until is null or original.visible_until is null or new_event_until is null then
      raise exception 'event window is unavailable' using errcode='PT409';
    end if;
  end if;
  if original.status not in ('live', 'paused') then
    raise exception 'the live post is no longer published' using errcode = 'PT409';
  end if;
  if not exists (select 1 from private.current_account_access u where u.id = original.owner_id) then
    raise exception 'post owner is no longer eligible' using errcode = 'PT409';
  end if;
  perform internal.assert_post_contacts_ready(edit.id,true);
  perform internal.assert_posting_verification_ready(edit.id,true);
  select c.channels into selected_channels from private.post_contacts c where c.post_id=edit.id;
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
  if original.kind='event' and original.status='live' then
    perform internal.assert_event_duplicate_absent(edit.id,true);
  end if;
  if not exists(select 1 from private.current_account_access u where u.id=original.owner_id) then
    raise exception 'post owner is no longer eligible' using errcode='PT409';
  end if;
  if original.kind='event' and (old_event_until<=clock_timestamp()
    or original.visible_until<=clock_timestamp() or new_event_until<=clock_timestamp()) then
    raise exception 'original or proposed event window has ended' using errcode='PT409';
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
    locality_label = edit.locality_label,
    visible_until = case when original.kind='event' then new_event_until else original.visible_until end,
    revision = revision + 1, content_updated_at = statement_timestamp()
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
  if original.kind in ('listing','event') then
    insert into private.post_contacts(post_id,post_kind,channels) values(original.id,original.kind,selected_channels)
      on conflict(post_id) do update set channels=excluded.channels;
  end if;
  perform internal.write_post_projection(original.id);
  if not exists(select 1 from private.current_account_access u where u.id=original.owner_id) then
    raise exception 'post owner is no longer eligible' using errcode='PT409';
  end if;
  if original.kind='event' and (old_event_until<=clock_timestamp()
    or original.visible_until<=clock_timestamp() or new_event_until<=clock_timestamp()) then
    raise exception 'original or proposed event window has ended' using errcode='PT409';
  end if;

  perform internal.assert_post_contacts_ready(original.id,true);
  perform internal.assert_posting_verification_ready(original.id,true);
  return jsonb_build_object('revision', rev, 'price_only', price_only);
end;
$$;

create or replace function internal.moderate_post(p_post_id uuid, p_expected_revision integer, p_decision text, p_reason text,
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
  if p_decision='approve' then
    perform internal.assert_post_contacts_ready(post.id,true);
    perform internal.assert_posting_verification_ready(post.id,true);
  end if;
  if p_decision = 'reject' then
    update private.post_activations set released_at = statement_timestamp(), release_reason = 'moderation'
      where post_id = post.id and released_at is null;
    update private.posts set status = 'rejected', status_reason = btrim(p_reason), revision = revision + 1
      where id = post.id;
  elsif original_id is not null then
    merged := internal.apply_post_edit(original_id, post.id);
    rev := (merged->>'revision')::integer;
  else
    if post.kind='event' then perform internal.assert_event_duplicate_absent(post.id,true); end if;
    if not exists(select 1 from private.current_account_access u where u.id=post.owner_id) then
      raise exception 'post owner is no longer eligible' using errcode='PT409';
    end if;
    select f.funded_until, f.max_photos, f.max_videos into funded_until, photo_limit, video_limit
      from internal.post_funding(post.id) f;
    if funded_until is null or funded_until <= (case when post.kind='event' then clock_timestamp() else statement_timestamp() end) then
      raise exception 'funding or event window has ended' using errcode = 'PT409';
    end if;
    if (select count(distinct pm.object_id) from private.post_media pm where pm.post_id=post.id and pm.purpose<>'video')>photo_limit
      or (select count(distinct pm.object_id) from private.post_media pm where pm.post_id=post.id and pm.purpose='video')>video_limit then
      raise exception 'funded media allowance changed since submission' using errcode='PT409';
    end if;
    update private.posts set status = 'live', published_at = statement_timestamp(), visible_until = funded_until,
      revision = revision + 1 where id = post.id;
    perform internal.write_post_projection(post.id);
    if post.kind='event' and (funded_until<=clock_timestamp() or not exists(
      select 1 from private.current_account_access u where u.id=post.owner_id)) then
      raise exception 'event window or owner is no longer eligible' using errcode='PT409';
    end if;

  end if;
  if p_decision='approve' then
    perform internal.assert_post_contacts_ready(coalesce(original_id,post.id),true);
    perform internal.assert_posting_verification_ready(coalesce(original_id,post.id),true);
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
perform pg_catalog.pg_notify('pgrst','reload schema');
end;
$publication_verification_readiness$;
