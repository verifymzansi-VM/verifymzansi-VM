-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.get_current_posting_terms()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.get_current_posting_terms();
$function$;
alter function api.get_current_posting_terms() owner to postgres;
revoke all on function api.get_current_posting_terms() from public;
grant execute on function api.get_current_posting_terms() to anon;
grant execute on function api.get_current_posting_terms() to authenticated;
