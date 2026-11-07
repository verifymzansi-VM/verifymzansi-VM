-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.close_account_evidence(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.close_account_evidence(p_user_id);
$function$;
alter function api.close_account_evidence(uuid) owner to postgres;
revoke all on function api.close_account_evidence(uuid) from public;
grant execute on function api.close_account_evidence(uuid) to service_role;
