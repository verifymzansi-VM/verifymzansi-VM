-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.copy_my_post(p_post uuid, p_request uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid := internal.price_draft_actor(); src private.posts; prior private.post_copies;
  copy_id uuid; answer jsonb;
begin
  if p_post is null or p_request is null then
    raise exception 'post and request required' using errcode='22023'; end if;
  perform internal.lock_verification_subject(actor);
  -- A repeated request answers with the copy it made.
  select c.* into prior from private.post_copies c where c.request_id = p_request;
  if found then
    select jsonb_build_object('id', p.id, 'source_id', prior.source_post_id, 'status', p.status, 'revision', p.revision)
      into answer from private.posts p where p.id = prior.post_id and p.owner_id = actor;
    if answer is null or prior.source_post_id is distinct from p_post then
      raise exception 'copy request changed' using errcode='PT409'; end if;
    perform internal.price_draft_actor();
    return answer;
  end if;
  select * into src from private.posts p where p.id = p_post and p.owner_id = actor and p.edit_of is null for share;
  if not found then raise exception 'owned post unavailable' using errcode='42501'; end if;
  if src.kind <> 'listing' or src.status = 'draft' then
    raise exception 'only a submitted Market listing can be copied' using errcode='22023', detail='copy_source_invalid'; end if;
  if exists(select 1 from private.frontend_content_holds h where h.post_id = src.id and h.released_at is null) then
    raise exception 'staff visibility hold requires independent release' using errcode='PT423', detail='staff_visibility_hold'; end if;
  if not exists(select 1 from internal.slot_package_now(actor)) then
    raise exception 'copying a post needs a running Multi-listing package' using errcode='PT402', detail='package_required'; end if;
  -- The existing draft path: category contract, draft allowance, contact buttons.
  copy_id := (internal.create_core_draft(src.kind, src.area, src.category_key,
    coalesce((select jsonb_build_object('contact_channels', to_jsonb(c.channels)) from private.post_contacts c
      where c.post_id = src.id), '{}'::jsonb), src.activity_key)->>'id')::uuid;
  update private.posts set title = src.title, description = src.description, province_id = src.province_id,
    city_id = src.city_id, locality_label = src.locality_label where id = copy_id;
  update private.listing_details d set price_mode = s.price_mode, price_cents = s.price_cents,
    price_negotiable = s.price_negotiable, attributes = s.attributes, attributes_version = s.attributes_version
    from private.listing_details s where d.post_id = copy_id and s.post_id = src.id;
  -- Photos and the listing logo: the same stored files, never the video or its cover.
  perform m.id from private.media_objects m
    where m.id in (select pm.object_id from private.post_media pm where pm.post_id = src.id
      union select pm.object_id from private.post_presentation_media pm where pm.post_id = src.id)
    order by m.id for update;
  insert into private.post_media(post_id, object_id, purpose, position, focal_x, focal_y)
    select copy_id, pm.object_id, pm.purpose, pm.position, pm.focal_x, pm.focal_y
    from private.post_media pm join private.media_objects m on m.id = pm.object_id
    where pm.post_id = src.id and pm.purpose <> 'video' and m.state = 'ready';
  insert into private.post_presentations(post_id, data, contacts)
    select copy_id, d.data || jsonb_build_object('layout_width', null, 'layout_height', null), '{}'::jsonb
    from private.post_presentations d where d.post_id = src.id;
  insert into private.post_presentation_media(post_id, object_id, purpose, position)
    select copy_id, pm.object_id, pm.purpose, pm.position
    from private.post_presentation_media pm join private.media_objects m on m.id = pm.object_id
    where pm.post_id = src.id and pm.purpose = 'logo' and m.state = 'ready';
  insert into private.post_copies(post_id, source_post_id, source_photo_sha256, request_id)
    values (copy_id, src.id, array(select distinct m.sha256 from private.post_media pm
      join private.media_objects m on m.id = pm.object_id
      where pm.post_id = src.id and pm.purpose in ('cover', 'gallery') and m.sha256 is not null
      order by m.sha256), p_request);
  perform internal.price_draft_actor(); -- final live owner/session check after all waits
  return (select jsonb_build_object('id', p.id, 'source_id', src.id, 'status', p.status, 'revision', p.revision)
    from private.posts p where p.id = copy_id);
end;
$function$;
alter function internal.copy_my_post(uuid,uuid) owner to postgres;
revoke all on function internal.copy_my_post(uuid,uuid) from public;
grant execute on function internal.copy_my_post(uuid,uuid) to authenticated;
