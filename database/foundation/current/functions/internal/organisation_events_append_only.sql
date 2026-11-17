-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.organisation_events_append_only()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  raise exception 'organisation events are append-only' using errcode='23514';
end;
$function$;
alter function internal.organisation_events_append_only() owner to postgres;
revoke all on function internal.organisation_events_append_only() from public;
