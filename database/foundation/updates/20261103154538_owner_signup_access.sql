-- Replace the forgotten one-address acceptance hook with owner-controlled
-- setup invitations. This does not open public signup or grant any staff role.
begin;
grant usage on schema private to supabase_auth_admin;
grant select(email,revoked_at) on private.owner_admin_invitations to supabase_auth_admin;
drop policy if exists owner_admin_signup_hook on private.owner_admin_invitations;
create policy owner_admin_signup_hook on private.owner_admin_invitations
  for select to supabase_auth_admin using (true);

do $migration$
declare body text; replacement text := $body$
  select case when jsonb_typeof(p_event #> '{user,email}')='string'
    and exists(select 1 from private.owner_admin_invitations i
      where i.email=lower(p_event #>> '{user,email}') and i.revoked_at is null)
    then '{}'::jsonb
    else '{"error":{"http_code":403,"message":"Registration is not open yet"}}'::jsonb end;
$body$;
begin
  select prosrc into strict body from pg_proc where oid='internal.acceptance_signup_guard(jsonb)'::regprocedure;
  if md5(body) not in ('f27b5ece5c30678934a56eff3df6b28e',md5(replacement)) then
    raise exception 'Unknown acceptance signup hook; review before changing access'; end if;
  execute format('create or replace function internal.acceptance_signup_guard(p_event jsonb) returns jsonb language sql stable security invoker set search_path=pg_catalog as %L',replacement);
end;
$migration$;
revoke all on function internal.acceptance_signup_guard(jsonb) from public,anon,authenticated,service_role;
grant execute on function internal.acceptance_signup_guard(jsonb) to supabase_auth_admin;
commit;
