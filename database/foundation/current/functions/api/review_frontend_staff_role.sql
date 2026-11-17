-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.review_frontend_staff_role(p_decision uuid, p_action text, p_version integer DEFAULT NULL::integer, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$select internal.review_frontend_staff_role(p_decision,p_action,p_version,p_note)$function$;
alter function api.review_frontend_staff_role(uuid,text,integer,text) owner to postgres;
revoke all on function api.review_frontend_staff_role(uuid,text,integer,text) from public;
grant execute on function api.review_frontend_staff_role(uuid,text,integer,text) to authenticated;
