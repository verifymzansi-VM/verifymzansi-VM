-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.approve_due_commissions(p_limit integer)
 RETURNS integer
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.approve_due_commissions(p_limit);
$function$;
alter function api.approve_due_commissions(integer) owner to postgres;
revoke all on function api.approve_due_commissions(integer) from public;
grant execute on function api.approve_due_commissions(integer) to service_role;
