-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.identity_submission_names_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  raise exception 'submitted legal names are immutable' using errcode='23514';
end;
$function$;
alter function internal.identity_submission_names_immutable() owner to postgres;
revoke all on function internal.identity_submission_names_immutable() from public;
