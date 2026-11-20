-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.signup_settings (
  id boolean default true not null,
  mode text default 'invite_only'::text not null,
  changed_at timestamp with time zone default statement_timestamp() not null,
  constraint signup_settings_mode_check CHECK (mode = ANY (ARRAY['invite_only'::text, 'open'::text])),
  constraint signup_settings_one_check CHECK (id),
  constraint signup_settings_pkey PRIMARY KEY (id)
);
alter table private.signup_settings owner to postgres;
alter table private.signup_settings enable row level security;
CREATE TRIGGER signup_settings_guard BEFORE DELETE OR UPDATE ON private.signup_settings FOR EACH ROW EXECUTE FUNCTION internal.signup_settings_guard();
CREATE TRIGGER signup_settings_no_truncate BEFORE TRUNCATE ON private.signup_settings FOR EACH STATEMENT EXECUTE FUNCTION internal.signup_settings_guard();
create policy signup_settings_signup_hook on private.signup_settings as permissive for select to supabase_auth_admin
  using (true);
revoke all on private.signup_settings from public;
grant select (id) on private.signup_settings to supabase_auth_admin;
grant select (mode) on private.signup_settings to supabase_auth_admin;
