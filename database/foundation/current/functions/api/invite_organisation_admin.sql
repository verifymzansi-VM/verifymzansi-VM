-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.invite_organisation_admin(p_org uuid, p_email text, p_token_hash text, p_reason text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.invite_organisation_admin(p_org,p_email,p_token_hash,p_reason);
$function$;
alter function api.invite_organisation_admin(uuid,text,text,text) owner to postgres;
revoke all on function api.invite_organisation_admin(uuid,text,text,text) from public;
grant execute on function api.invite_organisation_admin(uuid,text,text,text) to authenticated;
