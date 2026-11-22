-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.single_administrator(p_account uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  -- Single-administrator mode: the account holds an active admin role and an
  -- accepted ID review, and no other account with an active staff role has
  -- one. Never stored: a second ID-verified staff member ends it at once.
  select exists(select 1 from private.staff_roles r
      where r.user_id=p_account and r.role='admin' and r.revoked_at is null)
    and internal.current_verified_identity(p_account) is not null
    and not exists(select 1 from private.staff_roles r
      where r.revoked_at is null and r.user_id<>p_account
        and internal.current_verified_identity(r.user_id) is not null);
$function$;
alter function internal.single_administrator(uuid) owner to postgres;
revoke all on function internal.single_administrator(uuid) from public;
