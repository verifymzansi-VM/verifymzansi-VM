-- BF-04 disposable transport fixture, NOT a target migration or production DDL.
-- Test bootstrap provides auth.uid(), auth.jwt(), auth.sessions and API roles.
-- PostgREST must expose only api. SQL callers able to forge request settings are
-- outside the JWT trust boundary; real HTTP verification is still mandatory.
create schema api;
create schema private;
create schema internal;
revoke all on schema api, private, internal from public;
grant usage on schema api to anon, authenticated, service_role;
grant usage on schema internal to authenticated, service_role;
-- Global PUBLIC execute must be removed, not merely its per-schema defaults.
alter default privileges revoke execute on functions from public;

create table private.transport_resources (
  id uuid primary key,
  owner_id uuid not null,
  title text not null check (char_length(title) between 2 and 100),
  revision integer not null default 1 check (revision > 0),
  private_note text not null
);
alter table private.transport_resources enable row level security;
revoke all on private.transport_resources from public, anon, authenticated, service_role;

create table private.transport_jobs (id uuid primary key, kind text not null check (kind = 'reconcile'));
alter table private.transport_jobs enable row level security;
revoke all on private.transport_jobs from public, anon, authenticated, service_role;

-- This narrow internal definer is necessary to transact without giving browser
-- roles base-table privileges. It derives actor solely from verified JWT context,
-- checks a live session, scopes the resource and returns only an explicit DTO.
create function internal.rename_transport_resource(p_id uuid, p_revision integer, p_title text)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare
  actor uuid := auth.uid();
  claims jsonb := auth.jwt();
  result jsonb;
begin
  if actor is null or claims->>'role' is distinct from 'authenticated'
     or coalesce((claims->>'is_anonymous')::boolean, false) then
    raise exception 'authenticated member required' using errcode = '42501';
  end if;
  if not exists (select 1 from auth.sessions s where s.id::text = claims->>'session_id'
      and s.user_id = actor and (s.not_after is null or s.not_after > statement_timestamp())) then
    raise exception 'live session required' using errcode = '42501';
  end if;
  if p_title is null or char_length(btrim(p_title)) not between 2 and 100 or p_revision is null or p_revision < 1 then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  update private.transport_resources r set title = btrim(p_title), revision = r.revision + 1
    where r.id = p_id and r.owner_id = actor and r.revision = p_revision
    returning jsonb_build_object('id', r.id, 'title', r.title, 'revision', r.revision) into result;
  if result is null then raise exception 'resource unavailable or changed' using errcode = '42501'; end if;
  return result;
end;
$$;
revoke all on function internal.rename_transport_resource(uuid, integer, text) from public, anon, authenticated, service_role;
grant execute on function internal.rename_transport_resource(uuid, integer, text) to authenticated;

create function api.rename_transport_resource(p_id uuid, p_revision integer, p_title text)
returns jsonb language sql security invoker set search_path = pg_catalog as $$
  select internal.rename_transport_resource(p_id, p_revision, p_title);
$$;
revoke all on function api.rename_transport_resource(uuid, integer, text) from public, anon, authenticated, service_role;
grant execute on function api.rename_transport_resource(uuid, integer, text) to authenticated;

-- Machine work has no actor parameter and cannot substitute for member authority.
create function internal.enqueue_transport_reconciliation(p_id uuid)
returns boolean language plpgsql security definer set search_path = pg_catalog as $$
begin
  if auth.jwt()->>'role' is distinct from 'service_role' then
    raise exception 'service required' using errcode = '42501';
  end if;
  if p_id is null then raise exception 'invalid input' using errcode = '22023'; end if;
  insert into private.transport_jobs (id, kind) values (p_id, 'reconcile') on conflict (id) do nothing;
  return true;
end;
$$;
revoke all on function internal.enqueue_transport_reconciliation(uuid) from public, anon, authenticated, service_role;
grant execute on function internal.enqueue_transport_reconciliation(uuid) to service_role;
create function api.enqueue_transport_reconciliation(p_id uuid)
returns boolean language sql security invoker set search_path = pg_catalog as $$
  select internal.enqueue_transport_reconciliation(p_id);
$$;
revoke all on function api.enqueue_transport_reconciliation(uuid) from public, anon, authenticated, service_role;
grant execute on function api.enqueue_transport_reconciliation(uuid) to service_role;
