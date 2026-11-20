-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.slot_package_term_plan(p_term_days integer)
 RETURNS SETOF private.plan_versions
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select v.* from private.plan_versions v
  where internal.slot_package_plan(v.plan_code) and v.retired_at is null and v.duration_days = p_term_days
  order by v.version desc, v.created_at desc, v.id
  limit 1;
$function$;
alter function internal.slot_package_term_plan(integer) owner to postgres;
revoke all on function internal.slot_package_term_plan(integer) from public;
