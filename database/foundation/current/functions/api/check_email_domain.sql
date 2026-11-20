-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.check_email_domain(p_email text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.check_email_domain(p_email);
$function$;
alter function api.check_email_domain(text) owner to postgres;
revoke all on function api.check_email_domain(text) from public;
grant execute on function api.check_email_domain(text) to authenticated;
