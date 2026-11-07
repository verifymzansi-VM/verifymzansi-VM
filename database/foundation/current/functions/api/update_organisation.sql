-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.update_organisation(p_id uuid, p_expected_revision integer, p_patch jsonb, p_reason text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.update_organisation(p_id,p_expected_revision,p_patch,p_reason);
$function$;
alter function api.update_organisation(uuid,integer,jsonb,text) owner to postgres;
revoke all on function api.update_organisation(uuid,integer,jsonb,text) from public;
grant execute on function api.update_organisation(uuid,integer,jsonb,text) to authenticated;
