-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.set_identity_check_mode(p_mode text, p_reason text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.set_identity_check_mode(p_mode,p_reason);
$function$;
alter function api.set_identity_check_mode(text,text) owner to postgres;
revoke all on function api.set_identity_check_mode(text,text) from public;
grant execute on function api.set_identity_check_mode(text,text) to authenticated;
