-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.staff_decide_commission(p_commission uuid, p_action text, p_reason text, p_reference text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.staff_decide_commission(p_commission,p_action,p_reference,p_reason);
$function$;
alter function api.staff_decide_commission(uuid,text,text,text) owner to postgres;
revoke all on function api.staff_decide_commission(uuid,text,text,text) from public;
grant execute on function api.staff_decide_commission(uuid,text,text,text) to authenticated;
