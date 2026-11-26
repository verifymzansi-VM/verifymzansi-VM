-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.phone_number_banned_for(p_owner uuid, p_phone text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select internal.phone_number_banned(p_phone)
    or exists(select 1 from private.banned_phone_numbers n
      join private.banned_identities b on b.identity_hmac=n.identity_hmac
      join private.accepted_identity_facts f on f.identity_hmac=n.identity_hmac
      where n.phone=p_phone and f.owner_id=p_owner and b.retain_until>clock_timestamp());
$function$;
alter function internal.phone_number_banned_for(uuid,text) owner to postgres;
revoke all on function internal.phone_number_banned_for(uuid,text) from public;
