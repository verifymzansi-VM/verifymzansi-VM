-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.ban_identity_phone_numbers()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if new.retain_until<=clock_timestamp() then return null; end if;
  -- Every number the banned person's accounts verified and that is still on
  -- record, except one another person now holds as an active proof.
  insert into private.banned_phone_numbers(identity_hmac,phone)
  select distinct new.identity_hmac,p.phone from private.verification_phone_proofs p
  where p.owner_id in(select f.owner_id from private.accepted_identity_facts f where f.identity_hmac=new.identity_hmac)
    and not exists(select 1 from private.verification_phone_proofs o
      where o.phone=p.phone and o.revoked_at is null
        and o.owner_id not in(select f.owner_id from private.accepted_identity_facts f where f.identity_hmac=new.identity_hmac))
  on conflict do nothing;
  return null;
end;
$function$;
alter function internal.ban_identity_phone_numbers() owner to postgres;
revoke all on function internal.ban_identity_phone_numbers() from public;
