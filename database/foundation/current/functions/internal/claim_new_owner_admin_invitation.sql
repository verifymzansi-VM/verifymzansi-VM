-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.claim_new_owner_admin_invitation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if new.claimed_at is not null or new.revoked_at is not null then return new; end if;
  perform internal.claim_owner_admin_invitation_for(u.id) from auth.users u
    where lower(u.email)=new.email and (new.signed_up_at is null or u.id=new.signed_up_by)
    order by u.id;
  return new;
end$function$;
alter function internal.claim_new_owner_admin_invitation() owner to postgres;
revoke all on function internal.claim_new_owner_admin_invitation() from public;
