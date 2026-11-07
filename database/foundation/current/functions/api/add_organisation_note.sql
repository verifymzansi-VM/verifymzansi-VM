-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.add_organisation_note(p_org uuid, p_note text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.add_organisation_note(p_org,p_note);
$function$;
alter function api.add_organisation_note(uuid,text) owner to postgres;
revoke all on function api.add_organisation_note(uuid,text) from public;
grant execute on function api.add_organisation_note(uuid,text) to authenticated;
