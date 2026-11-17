-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.individual_slot_limit(p_identity text)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select coalesce((select l.slot_limit from private.individual_slot_limits l
    where l.identity_hmac=p_identity and l.revoked_at is null and l.ends_at>clock_timestamp()), 4);
$function$;
alter function internal.individual_slot_limit(text) owner to postgres;
revoke all on function internal.individual_slot_limit(text) from public;
