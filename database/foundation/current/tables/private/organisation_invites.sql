-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.organisation_invites (
  id uuid default gen_random_uuid() not null,
  organisation_id uuid not null,
  email text not null,
  token_hash text not null,
  invited_by uuid not null,
  expires_at timestamp with time zone not null,
  accepted_at timestamp with time zone,
  accepted_by uuid,
  revoked_at timestamp with time zone,
  revoked_by uuid,
  created_at timestamp with time zone default statement_timestamp() not null,
  constraint organisation_invites_check CHECK ((accepted_at IS NULL) = (accepted_by IS NULL)),
  constraint organisation_invites_check1 CHECK ((revoked_at IS NULL) = (revoked_by IS NULL)),
  constraint organisation_invites_check2 CHECK (accepted_at IS NULL OR revoked_at IS NULL),
  constraint organisation_invites_email_check CHECK (internal.enquiry_email_valid(email)),
  constraint organisation_invites_organisation_id_fkey FOREIGN KEY (organisation_id) REFERENCES private.organisations(id) ON DELETE CASCADE,
  constraint organisation_invites_pkey PRIMARY KEY (id),
  constraint organisation_invites_token_hash_check CHECK (token_hash ~ '^[a-f0-9]{64}$'::text),
  constraint organisation_invites_token_hash_key UNIQUE (token_hash)
);
alter table private.organisation_invites owner to postgres;
alter table private.organisation_invites enable row level security;
CREATE UNIQUE INDEX organisation_invites_open_idx ON private.organisation_invites USING btree (organisation_id, email) WHERE ((accepted_at IS NULL) AND (revoked_at IS NULL));
revoke all on private.organisation_invites from public;
