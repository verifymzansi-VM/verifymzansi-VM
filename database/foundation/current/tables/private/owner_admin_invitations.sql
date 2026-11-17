-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.owner_admin_invitations (
  email text not null,
  created_at timestamp with time zone default now() not null,
  claimed_by uuid,
  claimed_at timestamp with time zone,
  revoked_at timestamp with time zone,
  constraint owner_admin_invitations_check CHECK ((claimed_by IS NULL) = (claimed_at IS NULL)),
  constraint owner_admin_invitations_claimed_by_fkey FOREIGN KEY (claimed_by) REFERENCES auth.users(id) ON DELETE RESTRICT,
  constraint owner_admin_invitations_claimed_by_key UNIQUE (claimed_by),
  constraint owner_admin_invitations_email_check CHECK (email = lower(btrim(email)) AND length(email) >= 3 AND length(email) <= 254),
  constraint owner_admin_invitations_pkey PRIMARY KEY (email)
);
alter table private.owner_admin_invitations owner to postgres;
alter table private.owner_admin_invitations enable row level security;
create policy owner_admin_signup_hook on private.owner_admin_invitations as permissive for select to supabase_auth_admin
  using (true);
revoke all on private.owner_admin_invitations from public;
grant select (email) on private.owner_admin_invitations to supabase_auth_admin;
grant select (revoked_at) on private.owner_admin_invitations to supabase_auth_admin;
