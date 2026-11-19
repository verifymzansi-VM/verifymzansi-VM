-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.issue_staff_package_invoice(p_request_id uuid, p_due_days integer, p_reason text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.issue_staff_package_invoice(p_request_id, p_due_days, p_reason);
$function$;
alter function api.issue_staff_package_invoice(uuid,integer,text) owner to postgres;
revoke all on function api.issue_staff_package_invoice(uuid,integer,text) from public;
grant execute on function api.issue_staff_package_invoice(uuid,integer,text) to authenticated;
