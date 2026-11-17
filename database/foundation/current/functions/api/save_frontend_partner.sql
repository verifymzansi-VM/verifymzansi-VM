-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.save_frontend_partner(p_account uuid, p_action text, p_reason text, p_code text DEFAULT NULL::text, p_rate integer DEFAULT NULL::integer, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$select internal.save_frontend_partner(p_account,p_action,p_reason,p_code,p_rate,p_note)$function$;
alter function api.save_frontend_partner(uuid,text,text,text,integer,text) owner to postgres;
revoke all on function api.save_frontend_partner(uuid,text,text,text,integer,text) from public;
grant execute on function api.save_frontend_partner(uuid,text,text,text,integer,text) to authenticated;
