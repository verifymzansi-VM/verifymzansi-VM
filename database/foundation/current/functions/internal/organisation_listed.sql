-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.organisation_listed(o private.organisations)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select o.is_public and o.programme_status in('founding_trial','active_paid','affiliation_only');
$function$;
alter function internal.organisation_listed(private.organisations) owner to postgres;
revoke all on function internal.organisation_listed(private.organisations) from public;
