-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.slot_package_move_stuck(p_first_failed_at timestamp with time zone, p_package_ends timestamp with time zone)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select p_first_failed_at <= statement_timestamp() - interval '30 minutes'
    or coalesce(p_package_ends > statement_timestamp() and p_package_ends <= statement_timestamp() + interval '1 day',
      false);
$function$;
alter function internal.slot_package_move_stuck(timestamp with time zone,timestamp with time zone) owner to postgres;
revoke all on function internal.slot_package_move_stuck(timestamp with time zone,timestamp with time zone) from public;
