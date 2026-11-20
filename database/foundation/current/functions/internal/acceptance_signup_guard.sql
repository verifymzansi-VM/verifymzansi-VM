-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.acceptance_signup_guard(p_event jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  with applicant as (
    select lower(p_event #>> '{user,email}') as email
    where jsonb_typeof(p_event #> '{user,email}') = 'string'
  )
  select case
    when not exists (select 1 from applicant)
      then '{"error":{"http_code":403,"message":"Registration is not open yet"}}'::jsonb
    when exists (select 1 from applicant a join private.owner_admin_invitations i
        on i.email = a.email where i.revoked_at is null and i.signed_up_at is null)
      or exists (select 1 from applicant a join private.member_invitations m
        on m.email = a.email where m.revoked_at is null and m.claimed_at is null
          and m.expires_at > statement_timestamp())
      then '{}'::jsonb
    when coalesce((select s.mode from private.signup_settings s where s.id), 'invite_only') <> 'open'
      then '{"error":{"http_code":403,"message":"Registration is not open yet"}}'::jsonb
    when exists (select 1 from applicant a where internal.signup_email_domain_refused(a.email))
      then '{"error":{"http_code":403,"message":"Registration is not available for this email address"}}'::jsonb
    else '{}'::jsonb end;
$function$;
alter function internal.acceptance_signup_guard(jsonb) owner to postgres;
revoke all on function internal.acceptance_signup_guard(jsonb) from public;
grant execute on function internal.acceptance_signup_guard(jsonb) to supabase_auth_admin;
