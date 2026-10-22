-- Staff two-step policy and the application-table RLS guard.
-- Every staff capability, not only the sensitive ones, now requires a verified
-- authenticator app (TOTP) on the account and a TOTP verification in this
-- session within 12 hours. Sensitive capabilities keep the 15 minute window.
-- An AAL2 session reached through any other factor type grants nothing.

create or replace function internal.staff_actor(p_capability text)
returns uuid language plpgsql security definer set search_path = pg_catalog as $$
declare
  actor uuid := auth.uid();
  claims jsonb := auth.jwt();
  needs_mfa boolean;
  totp_at bigint;
begin
  if actor is null or claims->>'role' is distinct from 'authenticated'
    or coalesce((claims->>'is_anonymous')::boolean, false) or claims->>'aal' is distinct from 'aal2' then
    raise exception 'staff session with second factor required' using errcode = '42501';
  end if;
  if not exists (select 1 from auth.sessions s where s.id::text = claims->>'session_id' and s.user_id = actor
      and s.aal = 'aal2' and (s.not_after is null or s.not_after > clock_timestamp())) then
    raise exception 'live staff session required' using errcode = '42501';
  end if;
  if not exists (select 1 from private.current_account_access u where u.id = actor) then
    raise exception 'account suspended' using errcode = '42501';
  end if;
  if not exists (select 1 from auth.mfa_factors f where f.user_id = actor
      and f.factor_type = 'totp' and f.status = 'verified') then
    raise exception 'verified authenticator app required' using errcode = '42501';
  end if;
  select max((a->>'timestamp')::bigint) into totp_at
  from jsonb_array_elements(case when jsonb_typeof(claims->'amr') = 'array' then claims->'amr' else '[]' end) a
  where jsonb_typeof(a) = 'object' and a->>'method' = 'totp' and a->>'timestamp' ~ '^[0-9]{1,12}$';
  if totp_at is null or totp_at < extract(epoch from clock_timestamp() - interval '12 hours') then
    raise exception 'staff second-factor verification expired' using errcode = '42501';
  end if;
  select c.requires_recent_mfa into needs_mfa
  from private.staff_roles r join private.staff_capabilities c on c.role = r.role
  where r.user_id = actor and r.revoked_at is null and c.capability = p_capability;
  if not found then raise exception 'capability not granted' using errcode = '42501'; end if;
  if needs_mfa and totp_at < extract(epoch from clock_timestamp() - interval '15 minutes') then
    raise exception 'recent second-factor verification required' using errcode = '42501';
  end if;
  return actor;
end;
$$;
revoke all on function internal.staff_actor(text) from public, anon, authenticated, service_role;
grant execute on function internal.staff_actor(text) to authenticated;

-- New tables in application schemas get row level security automatically, and
-- no DDL may leave an application table without it. Platform roles that
-- supautils exempts from event triggers are unaffected.
create function internal.require_table_rls()
returns event_trigger language plpgsql security invoker set search_path = pg_catalog as $$
declare created record;
begin
  for created in select c.object_identity from pg_catalog.pg_event_trigger_ddl_commands() c
    where c.command_tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO') and c.object_type = 'table'
      and c.schema_name in ('public', 'api', 'private', 'internal')
  loop
    execute pg_catalog.format('alter table %s enable row level security', created.object_identity);
  end loop;
  if exists (select 1 from pg_catalog.pg_class t join pg_catalog.pg_namespace n on n.oid = t.relnamespace
      where t.relkind in ('r', 'p') and n.nspname in ('public', 'api', 'private', 'internal')
        and not t.relrowsecurity) then
    raise exception 'row level security is required on application tables' using errcode = '42501';
  end if;
end;
$$;
revoke all on function internal.require_table_rls() from public, anon, authenticated, service_role;
create event trigger require_table_rls on ddl_command_end
  when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO', 'ALTER TABLE')
  execute function internal.require_table_rls();
