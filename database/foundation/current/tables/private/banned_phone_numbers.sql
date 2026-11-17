-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.banned_phone_numbers (
  identity_hmac text not null,
  phone text not null,
  recorded_at timestamp with time zone default clock_timestamp() not null,
  constraint banned_phone_numbers_identity_hmac_fkey FOREIGN KEY (identity_hmac) REFERENCES private.banned_identities(identity_hmac) ON DELETE CASCADE,
  constraint banned_phone_numbers_phone_check CHECK (phone ~ '^\+27[0-9]{9}$'::text),
  constraint banned_phone_numbers_pkey PRIMARY KEY (identity_hmac, phone)
);
alter table private.banned_phone_numbers owner to postgres;
alter table private.banned_phone_numbers enable row level security;
CREATE INDEX banned_phone_numbers_phone_idx ON private.banned_phone_numbers USING btree (phone);
revoke all on private.banned_phone_numbers from public;
