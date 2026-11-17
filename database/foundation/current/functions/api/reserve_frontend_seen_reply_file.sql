-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.reserve_frontend_seen_reply_file(p_business uuid, p_case uuid, p_digest text, p_mime text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$select internal.reserve_frontend_seen_reply_file(p_business,p_case,p_digest,p_mime)$function$;
alter function api.reserve_frontend_seen_reply_file(uuid,uuid,text,text) owner to postgres;
revoke all on function api.reserve_frontend_seen_reply_file(uuid,uuid,text,text) from public;
grant execute on function api.reserve_frontend_seen_reply_file(uuid,uuid,text,text) to authenticated;
