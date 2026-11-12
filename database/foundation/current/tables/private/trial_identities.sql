-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.trial_identities (
  identity_hmac text not null,
  owner_id uuid,
  entitlement_id uuid,
  claimed_at timestamp with time zone default statement_timestamp() not null,
  detached_at timestamp with time zone,
  retain_until timestamp with time zone,
  constraint trial_identities_check CHECK ((owner_id IS NULL) = (detached_at IS NOT NULL)),
  constraint trial_identities_check1 CHECK ((owner_id IS NULL) = (entitlement_id IS NULL)),
  constraint trial_identities_check2 CHECK ((detached_at IS NULL) = (retain_until IS NULL)),
  constraint trial_identities_check3 CHECK (retain_until IS NULL OR retain_until = (detached_at + '3 years'::interval)),
  constraint trial_identities_entitlement_id_fkey FOREIGN KEY (entitlement_id) REFERENCES private.entitlements(id) ON DELETE RESTRICT,
  constraint trial_identities_entitlement_id_key UNIQUE (entitlement_id),
  constraint trial_identities_identity_hmac_check CHECK (identity_hmac ~ '^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$'::text),
  constraint trial_identities_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE RESTRICT,
  constraint trial_identities_pkey PRIMARY KEY (identity_hmac)
);
alter table private.trial_identities owner to postgres;
alter table private.trial_identities enable row level security;
CREATE INDEX trial_identities_expiry_idx ON private.trial_identities USING btree (retain_until) WHERE (retain_until IS NOT NULL);
CREATE INDEX trial_identities_owner_id_idx ON private.trial_identities USING btree (owner_id) WHERE (owner_id IS NOT NULL);
revoke all on private.trial_identities from public;
