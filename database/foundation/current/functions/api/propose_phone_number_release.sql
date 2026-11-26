-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.propose_phone_number_release(p_phone text, p_reason text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$select internal.propose_phone_number_release(p_phone,p_reason)$function$;
alter function api.propose_phone_number_release(text,text) owner to postgres;
revoke all on function api.propose_phone_number_release(text,text) from public;
grant execute on function api.propose_phone_number_release(text,text) to authenticated;
