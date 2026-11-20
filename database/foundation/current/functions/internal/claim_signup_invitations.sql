-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.claim_signup_invitations()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if new.email is null or new.is_anonymous then return new; end if;
  update private.member_invitations m set claimed_by = new.id, claimed_at = statement_timestamp()
  where m.email = lower(new.email) and m.claimed_at is null and m.revoked_at is null
    and m.expires_at > statement_timestamp();
  update private.owner_admin_invitations i set signed_up_by = new.id, signed_up_at = statement_timestamp()
  where i.email = lower(new.email) and i.signed_up_at is null and i.revoked_at is null;
  return new;
end;
$function$;
alter function internal.claim_signup_invitations() owner to postgres;
revoke all on function internal.claim_signup_invitations() from public;
