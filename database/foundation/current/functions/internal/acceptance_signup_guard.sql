-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.acceptance_signup_guard(p_event jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select case when jsonb_typeof(p_event #> '{user,email}')='string'
    and exists(select 1 from private.owner_admin_invitations i
      where i.email=lower(p_event #>> '{user,email}') and i.revoked_at is null)
    then '{}'::jsonb
    else '{"error":{"http_code":403,"message":"Registration is not open yet"}}'::jsonb end;
$function$;
alter function internal.acceptance_signup_guard(jsonb) owner to postgres;
revoke all on function internal.acceptance_signup_guard(jsonb) from public;
grant execute on function internal.acceptance_signup_guard(jsonb) to supabase_auth_admin;
