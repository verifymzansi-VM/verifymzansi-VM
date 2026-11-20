-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.record_scheduled_job_run(p_job text)
 RETURNS boolean
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.record_scheduled_job_run(p_job);
$function$;
alter function api.record_scheduled_job_run(text) owner to postgres;
revoke all on function api.record_scheduled_job_run(text) from public;
grant execute on function api.record_scheduled_job_run(text) to service_role;
