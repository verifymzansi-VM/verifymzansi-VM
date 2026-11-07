-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.set_frontend_feature_flag(p_key text, p_expected_revision integer, p_mode text, p_percent integer, p_roles text[], p_reason text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$select internal.set_frontend_feature_flag(p_key,p_expected_revision,p_mode,p_percent,p_roles,p_reason)$function$;
alter function api.set_frontend_feature_flag(text,integer,text,integer,text[],text) owner to postgres;
revoke all on function api.set_frontend_feature_flag(text,integer,text,integer,text[],text) from public;
grant execute on function api.set_frontend_feature_flag(text,integer,text,integer,text[],text) to authenticated;
