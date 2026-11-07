-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.manage_plan_member(p_entitlement_id uuid, p_action text, p_email text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.manage_plan_member(p_entitlement_id,p_action,p_email);
$function$;
alter function api.manage_plan_member(uuid,text,text) owner to postgres;
revoke all on function api.manage_plan_member(uuid,text,text) from public;
grant execute on function api.manage_plan_member(uuid,text,text) to authenticated;
