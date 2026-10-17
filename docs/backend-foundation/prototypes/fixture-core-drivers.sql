-- TEST-ONLY raw-core drivers for historical invariant regressions.
-- OMIT THE ENTIRE MODULE FROM EVERY TARGET BASELINE. No accepted identity proof.
create function api.grant_intro_trial(p_owner uuid, p_identity_hmac text, p_days integer)
returns jsonb language sql security definer set search_path = pg_catalog as $$
  select internal.grant_intro_trial(p_owner, p_identity_hmac, p_days);
$$;
revoke all on function api.grant_intro_trial(uuid, text, integer) from public, anon, authenticated, service_role;
grant execute on function api.grant_intro_trial(uuid, text, integer) to service_role;

create function api.record_identity_ban(p_decision_id uuid, p_identity_hmac text, p_category text)
returns jsonb language sql security definer set search_path = pg_catalog as $$
  select internal.record_identity_ban(p_decision_id, p_identity_hmac, p_category);
$$;
revoke all on function api.record_identity_ban(uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function api.record_identity_ban(uuid, text, text) to service_role;

