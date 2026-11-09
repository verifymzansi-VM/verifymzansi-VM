-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.frontend_report_action_receipts (
  id uuid default gen_random_uuid() not null,
  report_id uuid not null,
  expected_revision integer not null,
  claim_generation bigint not null,
  claim_nonce_digest text not null,
  actor_id uuid,
  action text not null,
  reason text not null,
  duration_days integer,
  emergency boolean not null,
  status text not null,
  acknowledged_until timestamp with time zone not null,
  created_at timestamp with time zone default clock_timestamp() not null,
  target_post_revision integer,
  constraint frontend_report_action_receipts_action_check CHECK (action = ANY (ARRAY['dismiss'::text, 'warn'::text, 'hide'::text, 'suspend'::text, 'ban'::text])),
  constraint frontend_report_action_receipts_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE SET NULL,
  constraint frontend_report_action_receipts_claim_generation_check CHECK (claim_generation > 0),
  constraint frontend_report_action_receipts_claim_nonce_digest_check CHECK (claim_nonce_digest ~ '^[a-f0-9]{64}$'::text),
  constraint frontend_report_action_receipts_duration_days_check CHECK (duration_days >= 1 AND duration_days <= 30),
  constraint frontend_report_action_receipts_expected_revision_check CHECK (expected_revision > 0),
  constraint frontend_report_action_receipts_pkey PRIMARY KEY (id),
  constraint frontend_report_action_receipts_reason_check CHECK (length(reason) >= 5 AND length(reason) <= 500),
  constraint frontend_report_action_receipts_report_id_claim_generation_key UNIQUE (report_id, claim_generation),
  constraint frontend_report_action_receipts_report_id_expected_revision_key UNIQUE (report_id, expected_revision),
  constraint frontend_report_action_receipts_report_id_fkey FOREIGN KEY (report_id) REFERENCES private.reports(id) ON DELETE CASCADE,
  constraint frontend_report_action_receipts_status_check CHECK (status = ANY (ARRAY['dismissed'::text, 'applied'::text, 'proposed'::text, 'emergency_applied'::text])),
  constraint frontend_report_action_receipts_target_post_revision_check CHECK (target_post_revision > 0)
);
alter table private.frontend_report_action_receipts owner to postgres;
alter table private.frontend_report_action_receipts enable row level security;
CREATE INDEX frontend_report_receipt_actor_idx ON private.frontend_report_action_receipts USING btree (actor_id);
revoke all on private.frontend_report_action_receipts from public;
