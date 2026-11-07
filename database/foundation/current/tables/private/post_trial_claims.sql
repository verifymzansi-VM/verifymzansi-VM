-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.post_trial_claims (
  post_id uuid not null,
  owner_id uuid not null,
  trial_entitlement_id uuid not null,
  claimed_at timestamp with time zone default clock_timestamp() not null,
  converted_at timestamp with time zone,
  converted_by_activation_id uuid,
  constraint post_trial_claims_check CHECK ((converted_at IS NULL) = (converted_by_activation_id IS NULL)),
  constraint post_trial_claims_check1 CHECK (converted_at IS NULL OR converted_at >= claimed_at),
  constraint post_trial_claims_converted_by_activation_id_fkey FOREIGN KEY (converted_by_activation_id) REFERENCES private.post_activations(id) ON DELETE RESTRICT,
  constraint post_trial_claims_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE RESTRICT,
  constraint post_trial_claims_pkey PRIMARY KEY (post_id),
  constraint post_trial_claims_post_id_fkey FOREIGN KEY (post_id) REFERENCES private.posts(id) ON DELETE CASCADE,
  constraint post_trial_claims_trial_entitlement_id_fkey FOREIGN KEY (trial_entitlement_id) REFERENCES private.entitlements(id) ON DELETE RESTRICT
);
alter table private.post_trial_claims owner to postgres;
alter table private.post_trial_claims enable row level security;
CREATE INDEX post_trial_claims_owner_idx ON private.post_trial_claims USING btree (owner_id, post_id);
revoke all on private.post_trial_claims from public;
