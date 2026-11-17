-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.verification_phone_proofs (
  id uuid default gen_random_uuid() not null,
  owner_id uuid not null,
  challenge_id uuid not null,
  phone text not null,
  verified_at timestamp with time zone default clock_timestamp() not null,
  contact_changed_at timestamp with time zone default clock_timestamp() not null,
  revoked_at timestamp with time zone,
  constraint verification_phone_proofs_challenge_id_key UNIQUE (challenge_id),
  constraint verification_phone_proofs_challenge_id_owner_id_fkey FOREIGN KEY (challenge_id, owner_id) REFERENCES private.verification_phone_challenges(id, owner_id),
  constraint verification_phone_proofs_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE RESTRICT,
  constraint verification_phone_proofs_phone_check CHECK (phone ~ '^\+27[0-9]{9}$'::text),
  constraint verification_phone_proofs_pkey PRIMARY KEY (id)
);
alter table private.verification_phone_proofs owner to postgres;
alter table private.verification_phone_proofs enable row level security;
CREATE UNIQUE INDEX verification_phone_owner_active_idx ON private.verification_phone_proofs USING btree (owner_id) WHERE (revoked_at IS NULL);
CREATE INDEX verification_phone_proofs_owner_id_idx ON private.verification_phone_proofs USING btree (owner_id);
CREATE UNIQUE INDEX verification_phone_unique_active_idx ON private.verification_phone_proofs USING btree (phone) WHERE (revoked_at IS NULL);
revoke all on private.verification_phone_proofs from public;
