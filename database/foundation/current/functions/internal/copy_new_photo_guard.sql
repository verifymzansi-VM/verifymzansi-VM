-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.copy_new_photo_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  -- Against the source's photos as they were when copied (the snapshot), so a
  -- later change to the source changes nothing.
  if new.category_key in ('vehicles', 'property')
    and exists(select 1 from private.post_copies c where c.post_id = new.id)
    and not exists(
      select 1 from private.post_media pm
      join private.media_objects m on m.id = pm.object_id
      join private.post_copies c on c.post_id = pm.post_id
      where pm.post_id = new.id and pm.purpose in ('cover', 'gallery') and m.kind = 'image' and m.sha256 is not null
        and m.sha256 <> all(c.source_photo_sha256)) then
    raise exception 'add at least one new photo of this item' using errcode='22023', detail='copy_new_photo_required';
  end if;
  return new;
end;
$function$;
alter function internal.copy_new_photo_guard() owner to postgres;
revoke all on function internal.copy_new_photo_guard() from public;
