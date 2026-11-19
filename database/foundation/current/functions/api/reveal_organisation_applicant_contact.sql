-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION api.reveal_organisation_applicant_contact(p_application uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.reveal_organisation_applicant_contact(p_application);
$function$;
alter function api.reveal_organisation_applicant_contact(uuid) owner to postgres;
revoke all on function api.reveal_organisation_applicant_contact(uuid) from public;
grant execute on function api.reveal_organisation_applicant_contact(uuid) to authenticated;
