-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.organisation_admins (
  organisation_id uuid not null,
  account_id uuid not null,
  role text not null,
  added_by uuid,
  created_at timestamp with time zone default statement_timestamp() not null,
  constraint organisation_admins_account_id_fkey FOREIGN KEY (account_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint organisation_admins_organisation_id_fkey FOREIGN KEY (organisation_id) REFERENCES private.organisations(id) ON DELETE CASCADE,
  constraint organisation_admins_pkey PRIMARY KEY (organisation_id, account_id),
  constraint organisation_admins_role_check CHECK (role = ANY (ARRAY['owner'::text, 'admin'::text]))
);
alter table private.organisation_admins owner to postgres;
alter table private.organisation_admins enable row level security;
CREATE INDEX organisation_admins_account_idx ON private.organisation_admins USING btree (account_id);
revoke all on private.organisation_admins from public;
