-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.get_frontend_report_review_queue(p_area text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$select internal.get_frontend_report_review_queue(p_area)$function$;
alter function api.get_frontend_report_review_queue(text) owner to postgres;
revoke all on function api.get_frontend_report_review_queue(text) from public;
grant execute on function api.get_frontend_report_review_queue(text) to authenticated;
