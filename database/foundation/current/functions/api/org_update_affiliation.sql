-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.org_update_affiliation(p_affiliation uuid, p_action text, p_value text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.org_update_affiliation(p_affiliation,p_action,p_value);
$function$;
alter function api.org_update_affiliation(uuid,text,text) owner to postgres;
revoke all on function api.org_update_affiliation(uuid,text,text) from public;
grant execute on function api.org_update_affiliation(uuid,text,text) to authenticated;
