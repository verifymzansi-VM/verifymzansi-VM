-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.complete_lost_email_alert(p_claim uuid, p_sent boolean)
 RETURNS boolean
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.complete_lost_email_alert(p_claim,p_sent);
$function$;
alter function api.complete_lost_email_alert(uuid,boolean) owner to postgres;
revoke all on function api.complete_lost_email_alert(uuid,boolean) from public;
grant execute on function api.complete_lost_email_alert(uuid,boolean) to service_role;
