-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.record_frontend_privacy_intake(p_type text, p_email text, p_phone text, p_description text, p_note text, p_received timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$select internal.record_frontend_privacy_intake(p_type,p_email,p_phone,p_description,p_note,p_received)$function$;
alter function api.record_frontend_privacy_intake(text,text,text,text,text,timestamp with time zone) owner to postgres;
revoke all on function api.record_frontend_privacy_intake(text,text,text,text,text,timestamp with time zone) from public;
grant execute on function api.record_frontend_privacy_intake(text,text,text,text,text,timestamp with time zone) to authenticated;
