-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.submit_report(p_post_id uuid, p_category text, p_description text, p_reporter_ip_hmac text, p_reporter_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.submit_report(p_post_id, p_category, p_description, p_reporter_id, p_reporter_ip_hmac);
$function$;
alter function api.submit_report(uuid,text,text,text,uuid) owner to postgres;
revoke all on function api.submit_report(uuid,text,text,text,uuid) from public;
grant execute on function api.submit_report(uuid,text,text,text,uuid) to service_role;
