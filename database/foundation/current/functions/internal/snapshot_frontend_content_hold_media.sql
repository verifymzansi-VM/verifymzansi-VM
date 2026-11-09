-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.snapshot_frontend_content_hold_media()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if new.post_id is not null and new.released_at is null then
    insert into private.frontend_content_hold_media(hold_id,object_id)
      select new.id,m.object_id from private.post_media m where m.post_id=new.post_id
      union
      select new.id,m.object_id from private.post_presentation_media m where m.post_id=new.post_id
      on conflict do nothing;
  end if;
  return null;
end$function$;
alter function internal.snapshot_frontend_content_hold_media() owner to postgres;
revoke all on function internal.snapshot_frontend_content_hold_media() from public;
