-- Explicit private listing/event contact selection. Local candidate only.
-- No raw number, public reveal or business contact policy is introduced.
do $post_contact_preferences$
begin
create function internal.canonical_post_channels(p_value jsonb)
returns text[] language plpgsql immutable security invoker set search_path=pg_catalog as $$
begin
  if jsonb_typeof(p_value) is distinct from 'array' then
    raise exception 'contact channels must be an array' using errcode='22023';
  end if;
  if jsonb_array_length(p_value)>4 or exists(select 1 from jsonb_array_elements(p_value) x
    where jsonb_typeof(x)<>'string' or x#>>'{}' not in ('call','whatsapp','form','in_app')) then
    raise exception 'choose supported contact channels' using errcode='22023';
  end if;
  return array(select channel from unnest(array['call','whatsapp','form']) with ordinality c(channel,position)
    where exists(select 1 from jsonb_array_elements_text(p_value) x
      where case when x='in_app' then 'form' else x end=c.channel) order by position);
end;
$$;
revoke all on function internal.canonical_post_channels(jsonb) from public,anon,authenticated,service_role;

create table private.post_contacts (
  post_id uuid primary key,
  post_kind text not null check(post_kind in ('listing','event')),
  channels text[] not null check(channels=internal.canonical_post_channels(to_jsonb(channels))),
  foreign key(post_id,post_kind) references private.posts(id,kind) on delete cascade
);
alter table private.post_contacts enable row level security;
revoke all on private.post_contacts from public,anon,authenticated,service_role;
create trigger post_contacts_edit_frozen before insert or update or delete on private.post_contacts
  for each row execute function internal.post_edit_guard();
create trigger post_contacts_no_truncate before truncate on private.post_contacts
  for each statement execute function internal.core_no_detail_truncate();

-- Selection is not an assurance claim. Each publication boundary checks the
-- current canonical proof; a phone is never duplicated into a post/contact row.
create function internal.assert_post_contacts_ready(p_post_id uuid,p_staff boolean)
returns void language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare post private.posts; chosen text[]; has_phone boolean; actor uuid;
begin
  if p_staff is null then raise exception 'caller context required' using errcode='22023'; end if;
  actor:=case when p_staff then internal.staff_actor('post:moderate') else internal.price_draft_actor() end;
  select * into post from private.posts p where p.id=p_post_id;
  select c.channels into chosen from private.post_contacts c where c.post_id=p_post_id;
  select exists(select 1 from private.verification_phone_proofs f
    where f.owner_id=post.owner_id and f.revoked_at is null) into has_phone;
  -- Derive the real caller again before any data-dependent refusal, including
  -- combined caller/phone loss during earlier post/media/projection waits.
  actor:=case when p_staff then internal.staff_actor('post:moderate') else internal.price_draft_actor() end;
  if post.id is null then raise exception 'post unavailable' using errcode='22023'; end if;
  if not p_staff and post.owner_id<>actor then
    raise exception 'owned post required' using errcode='42501';
  end if;
  if post.kind='business' then return; end if;
  if chosen is null or cardinality(chosen)=0 then
    raise exception 'choose at least one contact channel' using errcode='22023',detail='contact_channels_required';
  end if;
  if chosen && array['call','whatsapp'] and not has_phone then
    raise exception 'verify your account phone for selected contact channels' using errcode='PT409',detail='contact_phone_required';
  end if;
end;$$;
revoke all on function internal.assert_post_contacts_ready(uuid,boolean) from public,anon,authenticated,service_role;

create function internal.get_owner_post_contacts(p_post_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.price_draft_actor(); result jsonb;
begin
  select jsonb_build_object('id',p.id,'kind',p.kind,'status',p.status,'revision',p.revision,
    'edit_of',p.edit_of,'channels',to_jsonb(c.channels),
    'phone_ready',exists(select 1 from private.verification_phone_proofs f
      where f.owner_id=actor and f.revoked_at is null)) into result
  from private.posts p left join private.post_contacts c on c.post_id=p.id
  where p.id=p_post_id and p.owner_id=actor and p.kind in ('listing','event');
  perform internal.price_draft_actor();
  return result;
end;
$$;
revoke all on function internal.get_owner_post_contacts(uuid) from public,anon,authenticated,service_role;
grant execute on function internal.get_owner_post_contacts(uuid) to authenticated;
create function api.get_owner_post_contacts(p_post_id uuid)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.get_owner_post_contacts(p_post_id);
$$;
revoke all on function api.get_owner_post_contacts(uuid) from public,anon,authenticated,service_role;
grant execute on function api.get_owner_post_contacts(uuid) to authenticated;

create function internal.set_post_contacts(p_post_id uuid,p_expected_revision integer,p_channels jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.price_draft_actor(); post private.posts; chosen text[]; rev integer;
begin
  perform internal.assert_post_revision(p_expected_revision);
  chosen:=internal.canonical_post_channels(p_channels);
  perform original.id from private.posts original join private.posts copy on copy.edit_of=original.id
    where copy.id=p_post_id and copy.owner_id=actor for update of original;
  select * into post from private.posts p where p.id=p_post_id and p.owner_id=actor for update;
  perform internal.price_draft_actor();
  if post.id is null or post.kind not in ('listing','event') then
    raise exception 'post unavailable' using errcode='22023';
  end if;
  if post.status not in ('draft','rejected','paused') then
    raise exception 'only drafts can be edited' using errcode='22023';
  end if;
  if post.revision<>p_expected_revision then raise exception 'post changed' using errcode='PT409'; end if;
  insert into private.post_contacts(post_id,post_kind,channels) values(post.id,post.kind,chosen)
    on conflict(post_id) do update set channels=excluded.channels;
  update private.posts set revision=revision+1,content_updated_at=statement_timestamp()
    where id=post.id returning revision into rev;
  perform internal.price_draft_actor();
  return jsonb_build_object('id',post.id,'revision',rev,'channels',to_jsonb(chosen));
end;
$$;
revoke all on function internal.set_post_contacts(uuid,integer,jsonb) from public,anon,authenticated,service_role;
grant execute on function internal.set_post_contacts(uuid,integer,jsonb) to authenticated;
create function api.set_post_contacts(p_post_id uuid,p_expected_revision integer,p_channels jsonb)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select internal.set_post_contacts(p_post_id,p_expected_revision,p_channels);
$$;
revoke all on function api.set_post_contacts(uuid,integer,jsonb) from public,anon,authenticated,service_role;
grant execute on function api.set_post_contacts(uuid,integer,jsonb) to authenticated;

create or replace function internal.create_core_draft(p_kind text,p_area text,p_category_key text,p_detail jsonb,p_activity_key text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=internal.price_draft_actor(); post uuid; starts timestamptz; ends timestamptz; tz text; stored_activity text;
begin
  if not exists(select 1 from private.post_category_contracts c where c.category_key=p_category_key and c.kind=p_kind and c.area=p_area) then
    raise exception 'invalid kind area category' using errcode='22023';
  end if;
  if exists(select 1 from private.categories c where c.key=p_category_key and c.activity_required)
    and p_activity_key is null then
    raise exception 'activity required for this category' using errcode='22023';
  end if;
  if p_activity_key is not null and not exists(select 1 from private.category_activities a
    where a.category_key=p_category_key and a.key=p_activity_key) then
    raise exception 'activity does not belong to this category' using errcode='22023';
  end if;
  if jsonb_typeof(p_detail) is distinct from 'object' or octet_length(p_detail::text)>512 then
    raise exception 'invalid detail payload' using errcode='22023';
  end if;
  if p_kind='event' then
    if not(array(select jsonb_object_keys(p_detail)) <@ array['starts_at','ends_at','timezone','contact_channels'])
      or jsonb_typeof(p_detail->'starts_at') is distinct from 'string' or jsonb_typeof(p_detail->'ends_at') is distinct from 'string'
      or jsonb_typeof(p_detail->'timezone') is distinct from 'string'
      or (p_detail->>'starts_at') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]{1,3})?(Z|[+-](0[0-9]|1[0-4]):[0-5][0-9])$'
      or (p_detail->>'ends_at') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]{1,3})?(Z|[+-](0[0-9]|1[0-4]):[0-5][0-9])$' then
      raise exception 'explicit event window required' using errcode='22023';
    end if;
    starts:=(p_detail->>'starts_at')::timestamptz; ends:=(p_detail->>'ends_at')::timestamptz; tz:=p_detail->>'timezone';
    if not exists(select 1 from private.post_event_timezones z where z.name=tz) then
      raise exception 'supported IANA timezone required' using errcode='22023';
    end if;
  elsif p_kind='business' and p_detail<>'{}'::jsonb then
    raise exception 'business detail fields are not implemented' using errcode='22023';
  elsif p_kind='listing' and p_detail-'contact_channels'<>'{}'::jsonb then raise exception 'detail fields not implemented in this identity fixture' using errcode='22023';
  end if;
  if p_detail ? 'contact_channels' then
    perform internal.canonical_post_channels(p_detail->'contact_channels');
  end if;
  -- Draft allowance (DEC-29): 5 plus 1 per post in the owner's current
  -- packages (internal.draft_allowance in publication.sql). Edit copies are
  -- not counted. Never accept a caller-provided limit.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text,417));
  if (select count(*) from private.posts p where p.owner_id=actor and p.status='draft' and p.edit_of is null)
      >=internal.draft_allowance(actor) then
    raise exception 'draft limit reached' using errcode='PT429';
  end if;
  insert into private.posts(owner_id,kind,area,category_key,activity_key) values(actor,p_kind,p_area,p_category_key,p_activity_key) returning id,activity_key into post,stored_activity;
  if p_kind='listing' then insert into private.listing_details(post_id) values(post);
  elsif p_kind='business' then insert into private.business_details(post_id) values(post);
  else insert into private.event_details(post_id,starts_at,ends_at,timezone) values(post,starts,ends,tz); end if;
  if p_detail ? 'contact_channels' then
    insert into private.post_contacts(post_id,post_kind,channels)
      values(post,p_kind,internal.canonical_post_channels(p_detail->'contact_channels'));
  end if;
  perform internal.price_draft_actor(); -- final live owner/session check after all waits
  return jsonb_build_object('id',post,'kind',p_kind,'area',p_area,'category_key',p_category_key,'status','draft','revision',1)
    || case when stored_activity is not null then jsonb_build_object('activity_key',stored_activity) else '{}'::jsonb end;
end;
$$;

create or replace function internal.create_post_edit(p_post_id uuid, p_expected_revision integer)
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
  insert into private.post_contacts(post_id,post_kind,channels)
    select edit_id,c.post_kind,c.channels from private.post_contacts c where c.post_id=original.id;
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

create or replace function internal.edit_is_price_only(p_original_id uuid, p_edit_id uuid)
returns boolean language sql stable security invoker set search_path = pg_catalog as $$
  select coalesce((
    select o.kind = 'listing'
      and (o.category_key, o.activity_key, o.title, o.description, o.province_id, o.city_id, o.locality_label)
        is not distinct from (e.category_key, e.activity_key, e.title, e.description, e.province_id, e.city_id, e.locality_label)
      and (to_jsonb(od) - array['post_id', 'price_mode', 'price_cents', 'price_negotiable'])
        = (to_jsonb(ed) - array['post_id', 'price_mode', 'price_cents', 'price_negotiable'])
      and (select c.channels from private.post_contacts c where c.post_id=o.id)
        is not distinct from (select c.channels from private.post_contacts c where c.post_id=e.id)
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
  if p_decision='approve' then perform internal.assert_post_contacts_ready(post.id,true); end if;
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
  if p_decision='approve' then perform internal.assert_post_contacts_ready(coalesce(original_id,post.id),true); end if;
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
$post_contact_preferences$;
