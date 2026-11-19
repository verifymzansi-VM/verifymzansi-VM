-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.package_invoice_approval_above_cents()
 RETURNS bigint
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  -- A package invoice above R50,000 is issued only after a second staff
  -- member approves it (owner's decision 6 of 14 November 2026).
  select 5000000::bigint;
$function$;
alter function internal.package_invoice_approval_above_cents() owner to postgres;
revoke all on function internal.package_invoice_approval_above_cents() from public;
