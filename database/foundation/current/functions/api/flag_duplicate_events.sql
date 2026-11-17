-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.flag_duplicate_events(p_post_a uuid, p_expected_revision_a integer, p_post_b uuid, p_expected_revision_b integer, p_reason text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.flag_duplicate_events(p_post_a,p_expected_revision_a,p_post_b,p_expected_revision_b,p_reason);
$function$;
alter function api.flag_duplicate_events(uuid,integer,uuid,integer,text) owner to postgres;
revoke all on function api.flag_duplicate_events(uuid,integer,uuid,integer,text) from public;
grant execute on function api.flag_duplicate_events(uuid,integer,uuid,integer,text) to authenticated;
