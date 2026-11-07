-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.create_core_draft(p_kind text, p_area text, p_category_key text, p_detail jsonb, p_activity_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.create_core_draft(p_kind,p_area,p_category_key,p_detail,p_activity_key);
$function$;
alter function api.create_core_draft(text,text,text,jsonb,text) owner to postgres;
revoke all on function api.create_core_draft(text,text,text,jsonb,text) from public;
grant execute on function api.create_core_draft(text,text,text,jsonb,text) to authenticated;
