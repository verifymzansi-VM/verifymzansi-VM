-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

CREATE OR REPLACE FUNCTION internal.acceptance_signup_guard(p_event jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  with applicant as (
    select lower(p_event #>> '{user,email}') as email,
      substring(lower(p_event #>> '{user,email}') from '@([^@]+)$') as domain
    where jsonb_typeof(p_event #> '{user,email}') = 'string'
  )
  select case
    when not exists (select 1 from applicant)
      then '{"error":{"http_code":403,"message":"Registration is not open yet"}}'::jsonb
    when exists (select 1 from applicant a join private.owner_admin_invitations i
        on i.email = a.email where i.revoked_at is null)
      or exists (select 1 from applicant a join private.member_invitations m
        on m.email = a.email where m.revoked_at is null and m.expires_at > statement_timestamp())
      then '{}'::jsonb
    when coalesce((select s.mode from private.signup_settings s where s.id), 'invite_only') <> 'open'
      then '{"error":{"http_code":403,"message":"Registration is not open yet"}}'::jsonb
    when exists (select 1 from applicant a where a.domain is null
        or a.domain !~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?([.][a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'
        or substring(a.domain from '[^.]+$') ~ '^[0-9]+$'
        or substring(a.domain from '[^.]+$') in ('test', 'example', 'invalid', 'localhost', 'local',
          'internal', 'onion', 'arpa', 'lan', 'home', 'corp', 'intranet')
        or a.domain in ('example.com', 'example.net', 'example.org'))
      or exists (select 1 from applicant a join private.signup_blocked_domains b
        on a.domain = b.domain or right(a.domain, char_length(b.domain) + 1) = '.' || b.domain)
      then '{"error":{"http_code":403,"message":"Registration is not available for this email address"}}'::jsonb
    else '{}'::jsonb end;
$function$;
alter function internal.acceptance_signup_guard(jsonb) owner to postgres;
revoke all on function internal.acceptance_signup_guard(jsonb) from public;
grant execute on function internal.acceptance_signup_guard(jsonb) to supabase_auth_admin;
