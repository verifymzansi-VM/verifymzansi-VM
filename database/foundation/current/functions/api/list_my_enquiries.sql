-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.list_my_enquiries(p_limit integer DEFAULT 25, p_status text DEFAULT NULL::text, p_before_created timestamp with time zone DEFAULT NULL::timestamp with time zone, p_before_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.list_my_enquiries(p_status,p_before_created,p_before_id,p_limit);
$function$;
alter function api.list_my_enquiries(integer,text,timestamp with time zone,uuid) owner to postgres;
revoke all on function api.list_my_enquiries(integer,text,timestamp with time zone,uuid) from public;
grant execute on function api.list_my_enquiries(integer,text,timestamp with time zone,uuid) to authenticated;
