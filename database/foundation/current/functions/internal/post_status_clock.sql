-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.post_status_clock()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if new.status is distinct from old.status then new.status_changed_at := statement_timestamp(); end if;
  return new;
end;
$function$;
alter function internal.post_status_clock() owner to postgres;
revoke all on function internal.post_status_clock() from public;
