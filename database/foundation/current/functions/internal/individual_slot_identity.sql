-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.individual_slot_identity(p_owner uuid)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select coalesce(internal.current_verified_identity(p_owner),
    (select f.identity_hmac from private.accepted_identity_facts f where f.owner_id=p_owner
      order by f.reviewed_at desc, f.id desc limit 1));
$function$;
alter function internal.individual_slot_identity(uuid) owner to postgres;
revoke all on function internal.individual_slot_identity(uuid) from public;
