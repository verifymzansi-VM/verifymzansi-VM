-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.guard_posting_terms_document()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  raise exception 'published terms are immutable; publish a new version' using errcode='23514';
end;
$function$;
alter function internal.guard_posting_terms_document() owner to postgres;
revoke all on function internal.guard_posting_terms_document() from public;
