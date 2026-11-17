-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.process_frontend_privacy_request(p_case uuid, p_revision integer, p_action text, p_note text DEFAULT NULL::text, p_assignee uuid DEFAULT NULL::uuid, p_attestation text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$select internal.process_frontend_privacy_request(p_case,p_revision,p_action,p_note,p_assignee,p_attestation)$function$;
alter function api.process_frontend_privacy_request(uuid,integer,text,text,uuid,text) owner to postgres;
revoke all on function api.process_frontend_privacy_request(uuid,integer,text,text,uuid,text) from public;
grant execute on function api.process_frontend_privacy_request(uuid,integer,text,text,uuid,text) to authenticated;
