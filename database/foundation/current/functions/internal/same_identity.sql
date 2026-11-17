-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.same_identity(p_one uuid, p_other uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select coalesce(p_one = p_other, false)
    or exists(select 1 from private.accepted_identity_facts a
      join private.accepted_identity_facts b on b.identity_hmac=a.identity_hmac
      where a.owner_id=p_one and b.owner_id=p_other);
$function$;
alter function internal.same_identity(uuid,uuid) owner to postgres;
revoke all on function internal.same_identity(uuid,uuid) from public;
