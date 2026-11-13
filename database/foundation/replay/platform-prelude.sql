-- Replay only: stand-ins for what the hosted Supabase platform provides before
-- any foundation SQL runs (API roles, the Auth schema and its helper
-- functions, the extensions schema). Never apply this to a hosted project.
-- Only the Auth columns the foundation SQL references are modelled; the
-- schema fingerprint deliberately excludes Auth tables for that reason.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create role supabase_auth_admin nologin;
create role supabase_admin nologin;
create schema auth;
create schema extensions;
create table auth.users (
  id uuid primary key,
  instance_id uuid,
  aud text,
  role text,
  email text,
  encrypted_password text,
  email_confirmed_at timestamptz,
  confirmed_at timestamptz,
  is_anonymous boolean not null default false,
  deleted_at timestamptz,
  banned_until timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz,
  last_sign_in_at timestamptz,
  raw_user_meta_data jsonb,
  raw_app_meta_data jsonb,
  phone text,
  phone_confirmed_at timestamptz,
  is_sso_user boolean not null default false
);
create table auth.sessions (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz default now(),
  updated_at timestamptz,
  factor_id uuid,
  aal text,
  not_after timestamptz,
  refreshed_at timestamp
);
create table auth.mfa_factors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  friendly_name text,
  factor_type text not null,
  status text not null,
  created_at timestamptz default now(),
  updated_at timestamptz,
  last_challenged_at timestamptz
);
create table auth.audit_log_entries (
  instance_id uuid,
  id uuid primary key,
  payload json,
  created_at timestamptz,
  ip_address varchar(64) not null default ''
);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as
  $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create function auth.role() returns text language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.role', true), '')::text $$;
grant usage on schema auth to anon, authenticated, service_role, supabase_auth_admin;
