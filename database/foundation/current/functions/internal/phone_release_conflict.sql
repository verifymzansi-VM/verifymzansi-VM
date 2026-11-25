-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.phone_release_conflict(p_actor uuid, p_phone text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select exists(select 1 from private.verification_phone_proofs p where p.phone=p_phone and p.owner_id=p_actor)
    or exists(select 1 from private.banned_phone_numbers n
      join private.accepted_identity_facts f on f.identity_hmac=n.identity_hmac
      where n.phone=p_phone and f.owner_id=p_actor);
$function$;
alter function internal.phone_release_conflict(uuid,text) owner to postgres;
revoke all on function internal.phone_release_conflict(uuid,text) from public;
