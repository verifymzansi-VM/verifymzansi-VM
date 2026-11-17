-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.staff_audit_page(p_request jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.staff_audit_page(p_request);
$function$;
alter function api.staff_audit_page(jsonb) owner to postgres;
revoke all on function api.staff_audit_page(jsonb) from public;
grant execute on function api.staff_audit_page(jsonb) to authenticated;
