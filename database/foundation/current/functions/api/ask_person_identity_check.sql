-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.ask_person_identity_check(p_check uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.ask_person_identity_check(p_check,p_reason);
$function$;
alter function api.ask_person_identity_check(uuid,text) owner to postgres;
revoke all on function api.ask_person_identity_check(uuid,text) from public;
grant execute on function api.ask_person_identity_check(uuid,text) to authenticated;
