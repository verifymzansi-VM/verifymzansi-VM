-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.queue_claims (
  id bigint generated always as identity not null,
  post_id uuid,
  report_id uuid,
  claimed_by uuid,
  claim_generation bigint default 0 not null,
  claim_nonce uuid,
  claimed_at timestamp with time zone,
  claim_expires_at timestamp with time zone,
  renewals smallint default 0 not null,
  constraint queue_claims_check CHECK (num_nonnulls(post_id, report_id) = 1),
  constraint queue_claims_check1 CHECK (claimed_by IS NULL AND claim_nonce IS NULL AND claimed_at IS NULL AND claim_expires_at IS NULL AND renewals = 0 OR claimed_by IS NOT NULL AND claim_nonce IS NOT NULL AND claimed_at IS NOT NULL AND claim_expires_at IS NOT NULL AND claim_expires_at > claimed_at AND claim_generation > 0),
  constraint queue_claims_claim_generation_check CHECK (claim_generation >= 0),
  constraint queue_claims_claimed_by_fkey FOREIGN KEY (claimed_by) REFERENCES auth.users(id) ON DELETE RESTRICT,
  constraint queue_claims_pkey PRIMARY KEY (id),
  constraint queue_claims_post_id_fkey FOREIGN KEY (post_id) REFERENCES private.posts(id) ON DELETE CASCADE,
  constraint queue_claims_post_id_key UNIQUE (post_id),
  constraint queue_claims_renewals_check CHECK (renewals >= 0 AND renewals <= 4),
  constraint queue_claims_report_id_fkey FOREIGN KEY (report_id) REFERENCES private.reports(id) ON DELETE CASCADE,
  constraint queue_claims_report_id_key UNIQUE (report_id)
);
alter table private.queue_claims owner to postgres;
alter table private.queue_claims enable row level security;
CREATE INDEX queue_claims_holder_idx ON private.queue_claims USING btree (claimed_by, claim_expires_at) WHERE (claimed_by IS NOT NULL);
revoke all on private.queue_claims from public;
