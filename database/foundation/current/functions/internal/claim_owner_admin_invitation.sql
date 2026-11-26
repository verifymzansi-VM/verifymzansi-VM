-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.claim_owner_admin_invitation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if new.factor_type <> 'totp' or new.status <> 'verified' then return new; end if;
  perform internal.claim_owner_admin_invitation_for(new.user_id);
  return new;
end$function$;
alter function internal.claim_owner_admin_invitation() owner to postgres;
revoke all on function internal.claim_owner_admin_invitation() from public;
