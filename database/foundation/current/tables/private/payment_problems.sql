-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.payment_problems (
  id uuid default gen_random_uuid() not null,
  payment_id uuid,
  reason text not null,
  source text not null,
  needs_alert boolean default false not null,
  first_seen_at timestamp with time zone default clock_timestamp() not null,
  last_seen_at timestamp with time zone default clock_timestamp() not null,
  occurrences integer default 1 not null,
  alert_claim uuid,
  alert_claimed_until timestamp with time zone,
  alerted_at timestamp with time zone,
  constraint payment_problems_check CHECK (NOT needs_alert OR payment_id IS NOT NULL),
  constraint payment_problems_check1 CHECK (alerted_at IS NULL OR needs_alert),
  constraint payment_problems_occurrences_check CHECK (occurrences >= 1),
  constraint payment_problems_once UNIQUE NULLS NOT DISTINCT (payment_id, reason),
  constraint payment_problems_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES private.payments(id) ON DELETE CASCADE,
  constraint payment_problems_pkey PRIMARY KEY (id),
  constraint payment_problems_reason_check CHECK (reason = ANY (ARRAY['unsupported_transaction_status'::text, 'merchant_reference_mismatch'::text, 'site_code_mismatch'::text, 'test_mode_mismatch'::text, 'missing_transaction_id'::text, 'payment_id_mismatch'::text, 'transaction_id_mismatch'::text, 'currency_mismatch'::text, 'missing_amount'::text, 'missing_currency'::text, 'amount_mismatch'::text, 'invalid_json'::text, 'missing_merchant_reference'::text, 'missing_transaction_status'::text, 'unknown_payment'::text, 'unknown_reference'::text, 'request_mismatch'::text, 'missing_transaction'::text, 'conflicting_transaction'::text, 'transaction_reused'::text, 'complete_unfulfillable_target'::text, 'refunded_after_completion'::text, 'multiple_settlements'::text])),
  constraint payment_problems_source_check CHECK (source = ANY (ARRAY['notice'::text, 'status_check'::text]))
);
alter table private.payment_problems owner to postgres;
alter table private.payment_problems enable row level security;
CREATE INDEX payment_problems_alert_claim_idx ON private.payment_problems USING btree (alert_claim) WHERE (alert_claim IS NOT NULL);
CREATE INDEX payment_problems_alert_due_idx ON private.payment_problems USING btree (first_seen_at) WHERE (needs_alert AND (alerted_at IS NULL));
CREATE INDEX payment_problems_last_seen_idx ON private.payment_problems USING btree (last_seen_at);
revoke all on private.payment_problems from public;
