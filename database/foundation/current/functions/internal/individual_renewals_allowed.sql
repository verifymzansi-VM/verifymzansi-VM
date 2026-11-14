-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.individual_renewals_allowed(p_identity text, p_owner uuid, p_exclude uuid, p_chains uuid[])
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.individual_slots_extended(p_identity, p_owner, p_exclude, p_chains, null)
      <= internal.individual_slot_limit(p_identity)
    and coalesce((select internal.individual_slots_extended(p_identity, p_owner, p_exclude, p_chains, l.ends_at)
          <= internal.individual_slot_limit(null)
        from private.individual_slot_limits l
        where l.identity_hmac=p_identity and l.revoked_at is null and l.ends_at>clock_timestamp()), true);
$function$;
alter function internal.individual_renewals_allowed(text,uuid,uuid,uuid[]) owner to postgres;
revoke all on function internal.individual_renewals_allowed(text,uuid,uuid,uuid[]) from public;
