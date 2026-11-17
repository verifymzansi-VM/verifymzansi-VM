-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.identity_ban_bindings (
  decision_id uuid not null,
  fact_id uuid not null,
  identity_hmac text not null,
  category text not null,
  approved_at timestamp with time zone not null,
  retain_until timestamp with time zone not null,
  constraint identity_ban_bindings_category_check CHECK (category = ANY (ARRAY['fraud'::text, 'fake_listings'::text, 'harassment'::text, 'impersonation'::text, 'repeat_abuse'::text, 'other'::text])),
  constraint identity_ban_bindings_check CHECK (retain_until = (approved_at + '5 years'::interval)),
  constraint identity_ban_bindings_decision_id_fkey FOREIGN KEY (decision_id) REFERENCES private.decisions(id),
  constraint identity_ban_bindings_identity_hmac_check CHECK (identity_hmac ~ '^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$'::text),
  constraint identity_ban_bindings_pkey PRIMARY KEY (decision_id)
);
alter table private.identity_ban_bindings owner to postgres;
alter table private.identity_ban_bindings enable row level security;
CREATE INDEX identity_ban_bindings_expiry_idx ON private.identity_ban_bindings USING btree (retain_until);
revoke all on private.identity_ban_bindings from public;
