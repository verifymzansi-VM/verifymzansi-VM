-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.set_enquiry_status(p_id uuid, p_status text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.set_enquiry_status(p_id,p_status);
$function$;
alter function api.set_enquiry_status(uuid,text) owner to postgres;
revoke all on function api.set_enquiry_status(uuid,text) from public;
grant execute on function api.set_enquiry_status(uuid,text) to authenticated;
