-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.staff_save_partner(p_account uuid, p_action text, p_reason text, p_code text DEFAULT NULL::text, p_commission_bps integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.staff_save_partner(p_account,p_action,p_code,p_commission_bps,p_reason);
$function$;
alter function api.staff_save_partner(uuid,text,text,text,integer) owner to postgres;
revoke all on function api.staff_save_partner(uuid,text,text,text,integer) from public;
grant execute on function api.staff_save_partner(uuid,text,text,text,integer) to authenticated;
