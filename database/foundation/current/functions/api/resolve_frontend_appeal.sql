-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.resolve_frontend_appeal(p_appeal uuid, p_outcome text, p_reason text, p_effect_version integer DEFAULT NULL::integer, p_shorten_to timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$select internal.resolve_frontend_appeal(p_appeal,p_outcome,p_reason,p_effect_version,p_shorten_to)$function$;
alter function api.resolve_frontend_appeal(uuid,text,text,integer,timestamp with time zone) owner to postgres;
revoke all on function api.resolve_frontend_appeal(uuid,text,text,integer,timestamp with time zone) from public;
grant execute on function api.resolve_frontend_appeal(uuid,text,text,integer,timestamp with time zone) to authenticated;
