-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.propose_verified_identity_ban(p_owner uuid, p_fact uuid, p_category text, p_request uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.propose_verified_identity_ban(p_owner,p_fact,p_category,p_request);
$function$;
alter function api.propose_verified_identity_ban(uuid,uuid,text,uuid) owner to postgres;
revoke all on function api.propose_verified_identity_ban(uuid,uuid,text,uuid) from public;
grant execute on function api.propose_verified_identity_ban(uuid,uuid,text,uuid) to authenticated;
