-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.member_invitations (
  email text not null,
  invited_by uuid,
  invited_at timestamp with time zone default statement_timestamp() not null,
  expires_at timestamp with time zone default (statement_timestamp() + '30 days'::interval) not null,
  revoked_by uuid,
  revoked_at timestamp with time zone,
  constraint member_invitations_email_check CHECK (email = lower(btrim(email)) AND char_length(email) >= 3 AND char_length(email) <= 254 AND email ~ '^[^@[:space:][:cntrl:]]+@[^@[:space:][:cntrl:]]+[.][^@[:space:][:cntrl:]]+$'::text),
  constraint member_invitations_expiry_check CHECK (expires_at > invited_at),
  constraint member_invitations_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  constraint member_invitations_pkey PRIMARY KEY (email),
  constraint member_invitations_revoked_by_fkey FOREIGN KEY (revoked_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  constraint member_invitations_revoked_check CHECK (revoked_by IS NULL OR revoked_at IS NOT NULL)
);
alter table private.member_invitations owner to postgres;
alter table private.member_invitations enable row level security;
CREATE INDEX member_invitations_invited_at_idx ON private.member_invitations USING btree (invited_at);
CREATE INDEX member_invitations_invited_by_idx ON private.member_invitations USING btree (invited_by, invited_at) WHERE (invited_by IS NOT NULL);
CREATE INDEX member_invitations_revoked_by_idx ON private.member_invitations USING btree (revoked_by) WHERE (revoked_by IS NOT NULL);
create policy member_invitations_signup_hook on private.member_invitations as permissive for select to supabase_auth_admin
  using (true);
revoke all on private.member_invitations from public;
grant select (email) on private.member_invitations to supabase_auth_admin;
grant select (expires_at) on private.member_invitations to supabase_auth_admin;
grant select (revoked_at) on private.member_invitations to supabase_auth_admin;
