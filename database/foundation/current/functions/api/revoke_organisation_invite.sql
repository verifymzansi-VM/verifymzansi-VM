-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.revoke_organisation_invite(p_invite uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.revoke_organisation_invite(p_invite,p_reason);
$function$;
alter function api.revoke_organisation_invite(uuid,text) owner to postgres;
revoke all on function api.revoke_organisation_invite(uuid,text) from public;
grant execute on function api.revoke_organisation_invite(uuid,text) to authenticated;
