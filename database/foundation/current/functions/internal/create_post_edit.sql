-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.create_post_edit(p_post_id uuid, p_expected_revision integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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
$function$;
alter function internal.create_post_edit(uuid,integer) owner to postgres;
revoke all on function internal.create_post_edit(uuid,integer) from public;
grant execute on function internal.create_post_edit(uuid,integer) to authenticated;
