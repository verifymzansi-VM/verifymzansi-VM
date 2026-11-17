-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.account_erasures (
  user_id uuid not null,
  closed_at timestamp with time zone not null,
  erase_after timestamp with time zone not null,
  closed_by text not null,
  paid_until timestamp with time zone,
  erased_at timestamp with time zone,
  erased_by text,
  erased_counts jsonb,
  auth_removed_at timestamp with time zone,
  auth_checked_at timestamp with time zone,
  blocked_at timestamp with time zone,
  blocked_reason text,
  blocked_detail text,
  rejected_at timestamp with time zone,
  constraint account_erasures_after_grace CHECK (erased_at IS NULL OR erased_at >= erase_after),
  constraint account_erasures_auth CHECK (auth_removed_at IS NULL OR erased_at IS NOT NULL),
  constraint account_erasures_blocked CHECK ((blocked_at IS NULL) = (blocked_reason IS NULL)),
  constraint account_erasures_blocked_reason_check CHECK (blocked_reason = ANY (ARRAY['legal_hold'::text, 'fraud_hold'::text, 'content_hold'::text, 'report_open'::text, 'staff_role'::text, 'request_rejected'::text, 'payment_pending'::text, 'payment_unresolved'::text, 'refund_open'::text, 'transfer_waiting'::text, 'invoice_unpaid'::text, 'commission_unpaid'::text, 'error'::text])),
  constraint account_erasures_closed_by_check CHECK (closed_by = ANY (ARRAY['member'::text, 'staff'::text])),
  constraint account_erasures_counts CHECK (erased_counts IS NULL OR jsonb_typeof(erased_counts) = 'object'::text),
  constraint account_erasures_erased CHECK ((erased_at IS NULL) = (erased_by IS NULL) AND (erased_at IS NULL) = (erased_counts IS NULL)),
  constraint account_erasures_erased_by_check CHECK (erased_by = ANY (ARRAY['staff'::text, 'sweep'::text])),
  constraint account_erasures_error CHECK (blocked_detail IS NULL OR blocked_reason = 'error'::text AND blocked_detail ~ '^[0-9A-Z]{5}$'::text),
  constraint account_erasures_grace CHECK (erase_after = (closed_at + '30 days'::interval)),
  constraint account_erasures_pkey PRIMARY KEY (user_id)
);
alter table private.account_erasures owner to postgres;
alter table private.account_erasures enable row level security;
CREATE INDEX account_erasures_auth_idx ON private.account_erasures USING btree (erased_at) WHERE ((erased_at IS NOT NULL) AND (auth_removed_at IS NULL));
CREATE INDEX account_erasures_due_idx ON private.account_erasures USING btree (erase_after) WHERE (erased_at IS NULL);
revoke all on private.account_erasures from public;
