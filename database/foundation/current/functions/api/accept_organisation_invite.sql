-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.accept_organisation_invite(p_token_hash text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.accept_organisation_invite(p_token_hash);
$function$;
alter function api.accept_organisation_invite(text) owner to postgres;
revoke all on function api.accept_organisation_invite(text) from public;
grant execute on function api.accept_organisation_invite(text) to authenticated;
