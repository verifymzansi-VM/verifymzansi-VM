-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.release_frontend_content_hold_media()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if old.released_at is null and new.released_at is not null then
    delete from private.frontend_content_hold_media where hold_id=new.id;
  end if;
  return null;
end$function$;
alter function internal.release_frontend_content_hold_media() owner to postgres;
revoke all on function internal.release_frontend_content_hold_media() from public;
