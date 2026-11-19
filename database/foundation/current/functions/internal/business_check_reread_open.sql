-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.business_check_reread_open(p_decided_at timestamp with time zone)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  -- Whether the staff member who decided a business check (or, for a visit,
  -- was assigned to it) may still open its private details without claiming
  -- it: while it is undecided, and for 90 days after the decision. After that
  -- they claim it like anyone else.
  select p_decided_at is null or p_decided_at>clock_timestamp()-interval '90 days';
$function$;
alter function internal.business_check_reread_open(timestamp with time zone) owner to postgres;
revoke all on function internal.business_check_reread_open(timestamp with time zone) from public;
