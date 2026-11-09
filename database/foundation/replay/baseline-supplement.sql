-- Replay only: a reviewed baseline supplement. Never apply it to a hosted project.
--
-- Production received internal.acceptance_signup_guard(jsonb) outside the
-- repository, before update 20261103154538_owner_signup_access.sql replaced it.
-- That update refuses to run unless the function already exists, so a replay
-- from the repository alone stopped there. This file creates it with the body
-- that update installs (its guard accepts that body), so the replayed end state
-- equals production. The original body named an operator address and is
-- deliberately not reproduced.
create function internal.acceptance_signup_guard(p_event jsonb) returns jsonb
language sql stable security invoker set search_path=pg_catalog
as $body$
  select case when jsonb_typeof(p_event #> '{user,email}')='string'
    and exists(select 1 from private.owner_admin_invitations i
      where i.email=lower(p_event #>> '{user,email}') and i.revoked_at is null)
    then '{}'::jsonb
    else '{"error":{"http_code":403,"message":"Registration is not open yet"}}'::jsonb end;
$body$;
