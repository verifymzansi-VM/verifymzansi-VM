-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.purge_post_engagement()
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.note_scheduled_job_run('engagement_purge', internal.purge_post_engagement());
$function$;
alter function api.purge_post_engagement() owner to postgres;
revoke all on function api.purge_post_engagement() from public;
grant execute on function api.purge_post_engagement() to service_role;
