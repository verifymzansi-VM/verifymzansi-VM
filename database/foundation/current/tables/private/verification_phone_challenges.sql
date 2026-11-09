-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.verification_phone_challenges (
  id uuid default gen_random_uuid() not null,
  owner_id uuid not null,
  phone text not null,
  otp_hash text not null,
  attempts integer default 0 not null,
  created_at timestamp with time zone default clock_timestamp() not null,
  expires_at timestamp with time zone default (clock_timestamp() + '00:05:00'::interval) not null,
  verified_at timestamp with time zone,
  constraint verification_phone_challenges_attempts_check CHECK (attempts >= 0 AND attempts <= 5),
  constraint verification_phone_challenges_check CHECK (expires_at > created_at),
  constraint verification_phone_challenges_id_owner_id_key UNIQUE (id, owner_id),
  constraint verification_phone_challenges_otp_hash_check CHECK (length(otp_hash) >= 16 AND length(otp_hash) <= 512),
  constraint verification_phone_challenges_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE RESTRICT,
  constraint verification_phone_challenges_phone_check CHECK (phone ~ '^\+27[0-9]{9}$'::text),
  constraint verification_phone_challenges_pkey PRIMARY KEY (id)
);
alter table private.verification_phone_challenges owner to postgres;
alter table private.verification_phone_challenges enable row level security;
CREATE INDEX verification_phone_challenges_owner_idx ON private.verification_phone_challenges USING btree (owner_id, id);
revoke all on private.verification_phone_challenges from public;
