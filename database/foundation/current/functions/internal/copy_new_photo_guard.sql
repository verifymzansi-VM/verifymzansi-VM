-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.copy_new_photo_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if new.category_key in ('vehicles', 'property')
    and exists(select 1 from private.post_copies c where c.post_id = new.id and c.source_post_id is not null)
    and not exists(
      select 1 from private.post_media pm join private.media_objects m on m.id = pm.object_id
      where pm.post_id = new.id and pm.purpose in ('cover', 'gallery') and m.kind = 'image' and m.sha256 is not null
        and m.sha256 not in (select s.sha256 from private.post_copies c
          join private.post_media spm on spm.post_id = c.source_post_id
          join private.media_objects s on s.id = spm.object_id
          where c.post_id = new.id and s.sha256 is not null)) then
    raise exception 'add at least one new photo of this item' using errcode='22023', detail='copy_new_photo_required';
  end if;
  return new;
end;
$function$;
alter function internal.copy_new_photo_guard() owner to postgres;
revoke all on function internal.copy_new_photo_guard() from public;
