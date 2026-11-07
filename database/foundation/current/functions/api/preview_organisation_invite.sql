-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.preview_organisation_invite(p_token_hash text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.preview_organisation_invite(p_token_hash);
$function$;
alter function api.preview_organisation_invite(text) owner to postgres;
revoke all on function api.preview_organisation_invite(text) from public;
grant execute on function api.preview_organisation_invite(text) to anon;
grant execute on function api.preview_organisation_invite(text) to authenticated;
