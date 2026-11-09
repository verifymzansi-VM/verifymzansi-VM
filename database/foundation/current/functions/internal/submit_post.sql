-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.submit_post(p_post_id uuid, p_expected_revision integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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
    -- Free events: fair use of 5 active (pending or live) and 10 submissions
    -- per 30 days. The 10 are counted from the kept submission ledger, so an
    -- event removed by the lifecycle job keeps its place; an owner deleting
    -- their own event returns it (internal.delete_post).
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text, 909));
    perform internal.price_draft_actor(); -- fresh authority before quota or duplicate errors
    if (select count(*) from private.posts p where p.owner_id = actor and p.kind = 'event' and p.edit_of is null
          and p.status in ('pending_moderation', 'live') and p.id <> post.id) >= 5
      or (select count(distinct s.post_id) from private.event_submissions s where s.owner_id = actor
          and s.released_at is null and s.submitted_at > statement_timestamp() - interval '30 days' and s.post_id <> post.id) >= 10 then
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
  if post.kind = 'event' and post.edit_of is null then
    insert into private.event_submissions(owner_id, post_id, submitted_at) values (actor, post.id, statement_timestamp());
  end if;
  perform internal.assert_post_contacts_ready(post.id,false);
  perform internal.assert_posting_verification_ready(post.id,false);
  perform internal.price_draft_actor(); -- final live owner/session check after all waits
  return jsonb_build_object('id', post.id, 'status', 'pending_moderation', 'revision', rev);
end;
$function$;
alter function internal.submit_post(uuid,integer) owner to postgres;
revoke all on function internal.submit_post(uuid,integer) from public;
grant execute on function internal.submit_post(uuid,integer) to authenticated;
