-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.outbox_events (
  id uuid default gen_random_uuid() not null,
  kind text not null,
  subject_id uuid not null,
  owner_id uuid not null,
  dedupe_key text not null,
  created_at timestamp with time zone default statement_timestamp() not null,
  processed_at timestamp with time zone,
  delivery_attempts integer default 0 not null,
  delivery_claim uuid,
  delivery_until timestamp with time zone,
  delivery_after timestamp with time zone default statement_timestamp() not null,
  delivery_error text,
  constraint outbox_events_dedupe_key_key UNIQUE (dedupe_key),
  constraint outbox_events_delivery_attempts_check CHECK (delivery_attempts >= 0 AND delivery_attempts <= 20),
  constraint outbox_events_delivery_error_check CHECK (delivery_error IS NULL OR delivery_error ~ '^[a-z_]{1,80}$'::text),
  constraint outbox_events_kind_check CHECK (kind = ANY (ARRAY['payment_completed'::text, 'payment_reversed'::text, 'payment_reconciliation_required'::text, 'trial_started'::text, 'post_expired'::text, 'post_expiry_reminder'::text, 'draft_deletion_warning'::text, 'post_deleted'::text, 'verification_phone_confirmed'::text, 'identity_accepted'::text, 'enquiry_received'::text, 'account_warning'::text, 'content_hidden'::text, 'account_suspended'::text, 'account_banned'::text, 'appeal_decided'::text, 'business_check_update'::text, 'post_sold'::text, 'post_kept'::text, 'verification_returned'::text, 'slot_renewal_reminder'::text])),
  constraint outbox_events_pkey PRIMARY KEY (id)
);
alter table private.outbox_events owner to postgres;
alter table private.outbox_events enable row level security;
CREATE INDEX outbox_delivery_due_idx ON private.outbox_events USING btree (delivery_after, created_at) WHERE (processed_at IS NULL);
CREATE INDEX outbox_owner_history_idx ON private.outbox_events USING btree (owner_id, created_at DESC);
revoke all on private.outbox_events from public;
