-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.submit_enquiry(p_request_id uuid, p_post_id uuid, p_buyer_email text, p_message text, p_sender uuid DEFAULT NULL::uuid, p_buyer_name text DEFAULT NULL::text, p_buyer_phone text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.submit_enquiry(p_request_id,p_post_id,p_sender,p_buyer_name,p_buyer_email,p_buyer_phone,p_message);
$function$;
alter function api.submit_enquiry(uuid,uuid,text,text,uuid,text,text) owner to postgres;
revoke all on function api.submit_enquiry(uuid,uuid,text,text,uuid,text,text) from public;
grant execute on function api.submit_enquiry(uuid,uuid,text,text,uuid,text,text) to service_role;
