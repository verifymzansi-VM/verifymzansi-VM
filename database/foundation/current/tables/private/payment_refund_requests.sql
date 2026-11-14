-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.payment_refund_requests (
  id uuid default gen_random_uuid() not null,
  payment_id uuid not null,
  payment_line_id uuid,
  account_id uuid not null,
  kind text not null,
  reason_code text not null,
  reason text not null,
  ozow_reference text not null,
  amount_cents bigint not null,
  recorded_before_cents bigint not null,
  needs_approval boolean not null,
  status text not null,
  requested_by uuid not null,
  requested_at timestamp with time zone default statement_timestamp() not null,
  approved_by uuid,
  applied_at timestamp with time zone,
  released_activations integer,
  declined_by uuid,
  declined_at timestamp with time zone,
  decline_reason text,
  channel text default 'manual'::text not null,
  approved_at timestamp with time zone,
  ozow_transaction_id uuid,
  ozow_refund_id uuid,
  ozow_status text,
  ozow_status_at timestamp with time zone,
  ozow_requested_at timestamp with time zone,
  ozow_completed_at timestamp with time zone,
  sent_at timestamp with time zone,
  send_attempts integer default 0 not null,
  last_send_at timestamp with time zone,
  send_outcome text,
  failed_at timestamp with time zone,
  failure_reason text,
  returned_at timestamp with time zone,
  ozow_checked_at timestamp with time zone,
  ozow_missing_at timestamp with time zone,
  closed_by uuid,
  close_reason text,
  constraint payment_refund_requests_account_id_fkey FOREIGN KEY (account_id) REFERENCES auth.users(id) ON DELETE RESTRICT,
  constraint payment_refund_requests_amount_cents_check CHECK (amount_cents > 0),
  constraint payment_refund_requests_applied CHECK ((status = 'applied'::text) = (applied_at IS NOT NULL) AND (released_activations IS NULL OR status = 'applied'::text)),
  constraint payment_refund_requests_approval_rule CHECK (
CASE
    WHEN kind = 'refunded'::text THEN needs_approval = ((recorded_before_cents + amount_cents) > 100000)
    ELSE NOT needs_approval OR (recorded_before_cents + amount_cents) > 100000
END),
  constraint payment_refund_requests_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES auth.users(id) ON DELETE RESTRICT,
  constraint payment_refund_requests_approver CHECK (
CASE
    WHEN needs_approval AND (status <> ALL (ARRAY['awaiting_approval'::text, 'declined'::text])) THEN approved_by IS NOT NULL AND approved_by <> requested_by
    ELSE approved_by IS NULL
END),
  constraint payment_refund_requests_channel_check CHECK (channel = ANY (ARRAY['manual'::text, 'api'::text, 'dashboard'::text])),
  constraint payment_refund_requests_channel_rule CHECK (
CASE channel
    WHEN 'manual'::text THEN (status = ANY (ARRAY['awaiting_approval'::text, 'applied'::text, 'declined'::text])) AND ozow_transaction_id IS NULL AND ozow_refund_id IS NULL AND sent_at IS NULL AND send_attempts = 0 AND send_outcome IS NULL
    WHEN 'dashboard'::text THEN kind = 'refunded'::text AND (status = ANY (ARRAY['awaiting_approval'::text, 'applied'::text, 'declined'::text])) AND ozow_transaction_id IS NOT NULL AND ozow_refund_id IS NOT NULL AND ozow_reference = ((ozow_refund_id::text || ':'::text) || id::text) AND sent_at IS NULL AND send_attempts = 0 AND send_outcome IS NULL
    ELSE kind = 'refunded'::text AND ozow_transaction_id IS NOT NULL AND ozow_reference = ('vm-refund-'::text || id::text) AND (sent_at IS NULL OR (status = ANY (ARRAY['sent'::text, 'applied'::text, 'failed'::text, 'returned'::text]))) AND (sent_at IS NOT NULL OR (status <> ALL (ARRAY['sent'::text, 'applied'::text, 'returned'::text]))) AND (status <> ALL (ARRAY['awaiting_approval'::text, 'declined'::text])) = (approved_at IS NOT NULL) AND (status <> 'applied'::text OR ozow_refund_id IS NOT NULL)
END),
  constraint payment_refund_requests_closed CHECK ((NOT failure_reason IS DISTINCT FROM 'closed_by_staff'::text) = (closed_by IS NOT NULL AND close_reason IS NOT NULL) AND (closed_by IS NULL OR closed_by <> requested_by) AND (close_reason IS NULL OR internal.plain_text_valid(close_reason, 5, 500, true))),
  constraint payment_refund_requests_closed_by_fkey FOREIGN KEY (closed_by) REFERENCES auth.users(id) ON DELETE RESTRICT,
  constraint payment_refund_requests_decline_reason_check CHECK (decline_reason IS NULL OR internal.plain_text_valid(decline_reason, 5, 500, true)),
  constraint payment_refund_requests_declined CHECK ((status = 'declined'::text) = (declined_at IS NOT NULL AND declined_by IS NOT NULL AND decline_reason IS NOT NULL)),
  constraint payment_refund_requests_declined_by_fkey FOREIGN KEY (declined_by) REFERENCES auth.users(id) ON DELETE RESTRICT,
  constraint payment_refund_requests_failed CHECK ((status = 'failed'::text) = (failed_at IS NOT NULL AND failure_reason IS NOT NULL) AND (failure_reason IS NULL OR (failure_reason = ANY (ARRAY['ozow_refused'::text, 'ozow_auth'::text, 'ozow_failed'::text, 'ozow_cancelled'::text, 'ozow_invalid'::text, 'payment_changed'::text, 'closed_by_staff'::text])))),
  constraint payment_refund_requests_kind_check CHECK (kind = ANY (ARRAY['refunded'::text, 'chargeback'::text])),
  constraint payment_refund_requests_line_fkey FOREIGN KEY (payment_line_id, payment_id) REFERENCES private.payment_lines(id, payment_id) ON DELETE CASCADE,
  constraint payment_refund_requests_ozow_reference_check CHECK (ozow_reference ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{3,99}$'::text),
  constraint payment_refund_requests_ozow_status_check CHECK ((ozow_status IS NULL) = (ozow_status_at IS NULL) AND (ozow_status IS NULL OR (ozow_status = ANY (ARRAY['Pending'::text, 'Submitted'::text, 'Complete'::text, 'Failed'::text, 'Cancelled'::text, 'Returned'::text, 'Invalid'::text, 'PendingInvestigation'::text, 'Error'::text])))),
  constraint payment_refund_requests_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES private.payments(id) ON DELETE CASCADE,
  constraint payment_refund_requests_pkey PRIMARY KEY (id),
  constraint payment_refund_requests_reason_check CHECK (internal.plain_text_valid(reason, 5, 500, true)),
  constraint payment_refund_requests_reason_code_check CHECK (reason_code = ANY (ARRAY['billing_error'::text, 'duplicate'::text, 'our_failure_after_fix_offered'::text, 's14_cancellation'::text, 'breach_credit'::text])),
  constraint payment_refund_requests_recorded_before_cents_check CHECK (recorded_before_cents >= 0),
  constraint payment_refund_requests_released_activations_check CHECK (released_activations >= 0),
  constraint payment_refund_requests_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES auth.users(id) ON DELETE RESTRICT,
  constraint payment_refund_requests_returned CHECK ((status = 'returned'::text) = (returned_at IS NOT NULL)),
  constraint payment_refund_requests_send_state CHECK (send_attempts >= 0 AND send_attempts <= 3 AND (send_attempts = 0) = (last_send_at IS NULL) AND (send_attempts = 0) = (send_outcome IS NULL) AND (send_outcome IS NULL OR (send_outcome = ANY (ARRAY['unknown'::text, 'accepted'::text, 'refused'::text])))),
  constraint payment_refund_requests_status_check CHECK (status = ANY (ARRAY['awaiting_approval'::text, 'approved'::text, 'sent'::text, 'applied'::text, 'failed'::text, 'returned'::text, 'declined'::text]))
);
alter table private.payment_refund_requests owner to postgres;
alter table private.payment_refund_requests enable row level security;
CREATE INDEX payment_refund_requests_account_idx ON private.payment_refund_requests USING btree (account_id);
CREATE INDEX payment_refund_requests_approved_by_idx ON private.payment_refund_requests USING btree (approved_by) WHERE (approved_by IS NOT NULL);
CREATE INDEX payment_refund_requests_closed_by_idx ON private.payment_refund_requests USING btree (closed_by) WHERE (closed_by IS NOT NULL);
CREATE INDEX payment_refund_requests_declined_by_idx ON private.payment_refund_requests USING btree (declined_by) WHERE (declined_by IS NOT NULL);
CREATE UNIQUE INDEX payment_refund_requests_in_flight_idx ON private.payment_refund_requests USING btree (payment_id) WHERE (status = ANY (ARRAY['awaiting_approval'::text, 'approved'::text, 'sent'::text]));
CREATE INDEX payment_refund_requests_line_idx ON private.payment_refund_requests USING btree (payment_line_id, payment_id) WHERE (payment_line_id IS NOT NULL);
CREATE UNIQUE INDEX payment_refund_requests_ozow_key_idx ON private.payment_refund_requests USING btree (lower(COALESCE((ozow_refund_id)::text, ozow_reference))) WHERE (status <> 'declined'::text);
CREATE UNIQUE INDEX payment_refund_requests_ozow_refund_idx ON private.payment_refund_requests USING btree (ozow_refund_id) WHERE ((ozow_refund_id IS NOT NULL) AND (status <> 'declined'::text));
CREATE INDEX payment_refund_requests_payment_idx ON private.payment_refund_requests USING btree (payment_id);
CREATE UNIQUE INDEX payment_refund_requests_reference_idx ON private.payment_refund_requests USING btree (lower(ozow_reference));
CREATE INDEX payment_refund_requests_requested_by_idx ON private.payment_refund_requests USING btree (requested_by);
CREATE INDEX payment_refund_requests_send_due_idx ON private.payment_refund_requests USING btree (status, last_send_at) WHERE ((channel = 'api'::text) AND (status = ANY (ARRAY['approved'::text, 'sent'::text])));
CREATE INDEX payment_refund_requests_transaction_idx ON private.payment_refund_requests USING btree (ozow_transaction_id) WHERE (ozow_transaction_id IS NOT NULL);
CREATE UNIQUE INDEX payment_refund_requests_waiting_idx ON private.payment_refund_requests USING btree (payment_id) WHERE (status = 'awaiting_approval'::text);
CREATE TRIGGER payment_refund_requests_guard BEFORE INSERT OR UPDATE ON private.payment_refund_requests FOR EACH ROW EXECUTE FUNCTION internal.payment_refund_request_guard();
revoke all on private.payment_refund_requests from public;
