-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.media_unlink_clock()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  update private.media_objects set unlinked_at = statement_timestamp() where id = old.object_id;
  return null;
end;
$function$;
alter function internal.media_unlink_clock() owner to postgres;
revoke all on function internal.media_unlink_clock() from public;
