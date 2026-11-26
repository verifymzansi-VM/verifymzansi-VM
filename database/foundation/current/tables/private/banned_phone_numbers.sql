-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.banned_phone_numbers (
  identity_hmac text not null,
  phone text not null,
  recorded_at timestamp with time zone default clock_timestamp() not null,
  release_reason text,
  release_proposed_by uuid,
  release_proposed_at timestamp with time zone,
  released_by uuid,
  released_at timestamp with time zone,
  constraint banned_phone_numbers_identity_hmac_fkey FOREIGN KEY (identity_hmac) REFERENCES private.banned_identities(identity_hmac) ON DELETE CASCADE,
  constraint banned_phone_numbers_phone_check CHECK (phone ~ '^\+27[0-9]{9}$'::text),
  constraint banned_phone_numbers_pkey PRIMARY KEY (identity_hmac, phone),
  constraint banned_phone_numbers_release_check CHECK (released_at IS NULL OR release_proposed_at IS NOT NULL),
  constraint banned_phone_numbers_release_proposed_by_fkey FOREIGN KEY (release_proposed_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  constraint banned_phone_numbers_release_reason_check CHECK (release_reason IS NULL OR length(release_reason) >= 10 AND length(release_reason) <= 500),
  constraint banned_phone_numbers_release_request_check CHECK ((release_proposed_at IS NULL) = (release_reason IS NULL)),
  constraint banned_phone_numbers_released_by_fkey FOREIGN KEY (released_by) REFERENCES auth.users(id) ON DELETE SET NULL
);
alter table private.banned_phone_numbers owner to postgres;
alter table private.banned_phone_numbers enable row level security;
CREATE INDEX banned_phone_numbers_phone_idx ON private.banned_phone_numbers USING btree (phone);
CREATE INDEX banned_phone_numbers_release_proposed_by_idx ON private.banned_phone_numbers USING btree (release_proposed_by) WHERE (release_proposed_by IS NOT NULL);
CREATE INDEX banned_phone_numbers_released_by_idx ON private.banned_phone_numbers USING btree (released_by) WHERE (released_by IS NOT NULL);
revoke all on private.banned_phone_numbers from public;
