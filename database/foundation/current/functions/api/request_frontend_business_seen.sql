-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.request_frontend_business_seen(p_business uuid, p_method text, p_slots text[], p_consent boolean, p_address text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$select internal.request_frontend_business_seen(p_business,p_method,p_slots,p_consent,p_address)$function$;
alter function api.request_frontend_business_seen(uuid,text,text[],boolean,text) owner to postgres;
revoke all on function api.request_frontend_business_seen(uuid,text,text[],boolean,text) from public;
grant execute on function api.request_frontend_business_seen(uuid,text,text[],boolean,text) to authenticated;
