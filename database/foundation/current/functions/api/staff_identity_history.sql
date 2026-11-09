-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.staff_identity_history(p_owner uuid, p_before_time timestamp with time zone DEFAULT NULL::timestamp with time zone, p_before_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.staff_identity_history(p_owner,p_before_time,p_before_id);
$function$;
alter function api.staff_identity_history(uuid,timestamp with time zone,uuid) owner to postgres;
revoke all on function api.staff_identity_history(uuid,timestamp with time zone,uuid) from public;
grant execute on function api.staff_identity_history(uuid,timestamp with time zone,uuid) to authenticated;
