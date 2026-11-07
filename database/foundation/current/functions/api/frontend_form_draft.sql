-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.frontend_form_draft(p_flow text, p_action text, p_step integer DEFAULT NULL::integer, p_data jsonb DEFAULT NULL::jsonb, p_expected_account uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.frontend_form_draft(p_flow,p_action,p_step,p_data,p_expected_account)
$function$;
alter function api.frontend_form_draft(text,text,integer,jsonb,uuid) owner to postgres;
revoke all on function api.frontend_form_draft(text,text,integer,jsonb,uuid) from public;
grant execute on function api.frontend_form_draft(text,text,integer,jsonb,uuid) to authenticated;
