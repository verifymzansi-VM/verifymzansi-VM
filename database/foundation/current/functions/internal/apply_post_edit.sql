-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.apply_post_edit(p_original_id uuid, p_edit_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
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
  perform internal.copy_frontend_post_presentation(edit.id,original.id); delete from private.posts where id = edit.id; -- with its details, links and queue claim
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
$function$;
alter function internal.apply_post_edit(uuid,uuid) owner to postgres;
revoke all on function internal.apply_post_edit(uuid,uuid) from public;
