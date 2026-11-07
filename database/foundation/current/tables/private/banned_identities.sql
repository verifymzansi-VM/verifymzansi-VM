-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.banned_identities (
  identity_hmac text not null,
  decision_id uuid not null,
  category text not null,
  banned_at timestamp with time zone default statement_timestamp() not null,
  retain_until timestamp with time zone not null,
  constraint banned_identities_category_check CHECK (category = ANY (ARRAY['fraud'::text, 'fake_listings'::text, 'harassment'::text, 'impersonation'::text, 'repeat_abuse'::text, 'other'::text])),
  constraint banned_identities_check CHECK (retain_until = (banned_at + '5 years'::interval)),
  constraint banned_identities_decision_id_fkey FOREIGN KEY (decision_id) REFERENCES private.decisions(id) ON DELETE RESTRICT,
  constraint banned_identities_identity_hmac_check CHECK (identity_hmac ~ '^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$'::text),
  constraint banned_identities_pkey PRIMARY KEY (identity_hmac)
);
alter table private.banned_identities owner to postgres;
alter table private.banned_identities enable row level security;
CREATE INDEX banned_identities_expiry_idx ON private.banned_identities USING btree (retain_until);
revoke all on private.banned_identities from public;
