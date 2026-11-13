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
    WHEN status = 'applied'::text AND needs_approval THEN approved_by IS NOT NULL AND approved_by <> requested_by
    ELSE approved_by IS NULL
END),
  constraint payment_refund_requests_decline_reason_check CHECK (decline_reason IS NULL OR internal.plain_text_valid(decline_reason, 5, 500, true)),
  constraint payment_refund_requests_declined CHECK ((status = 'declined'::text) = (declined_at IS NOT NULL AND declined_by IS NOT NULL AND decline_reason IS NOT NULL)),
  constraint payment_refund_requests_declined_by_fkey FOREIGN KEY (declined_by) REFERENCES auth.users(id) ON DELETE RESTRICT,
  constraint payment_refund_requests_kind_check CHECK (kind = ANY (ARRAY['refunded'::text, 'chargeback'::text])),
  constraint payment_refund_requests_line_fkey FOREIGN KEY (payment_line_id, payment_id) REFERENCES private.payment_lines(id, payment_id) ON DELETE CASCADE,
  constraint payment_refund_requests_ozow_reference_check CHECK (ozow_reference ~ '^[A-Za-z0-9][A-Za-z0-9 ._:/-]{3,99}$'::text AND ozow_reference = btrim(ozow_reference) AND ozow_reference !~~ '%  %'::text),
  constraint payment_refund_requests_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES private.payments(id) ON DELETE CASCADE,
  constraint payment_refund_requests_pkey PRIMARY KEY (id),
  constraint payment_refund_requests_reason_check CHECK (internal.plain_text_valid(reason, 5, 500, true)),
  constraint payment_refund_requests_reason_code_check CHECK (reason_code = ANY (ARRAY['billing_error'::text, 'duplicate'::text, 'our_failure_after_fix_offered'::text, 's14_cancellation'::text, 'breach_credit'::text])),
  constraint payment_refund_requests_recorded_before_cents_check CHECK (recorded_before_cents >= 0),
  constraint payment_refund_requests_released_activations_check CHECK (released_activations >= 0),
  constraint payment_refund_requests_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES auth.users(id) ON DELETE RESTRICT,
  constraint payment_refund_requests_status_check CHECK (status = ANY (ARRAY['awaiting_approval'::text, 'applied'::text, 'declined'::text]))
);
alter table private.payment_refund_requests owner to postgres;
alter table private.payment_refund_requests enable row level security;
CREATE INDEX payment_refund_requests_account_idx ON private.payment_refund_requests USING btree (account_id);
CREATE INDEX payment_refund_requests_approved_by_idx ON private.payment_refund_requests USING btree (approved_by) WHERE (approved_by IS NOT NULL);
CREATE INDEX payment_refund_requests_declined_by_idx ON private.payment_refund_requests USING btree (declined_by) WHERE (declined_by IS NOT NULL);
CREATE INDEX payment_refund_requests_line_idx ON private.payment_refund_requests USING btree (payment_line_id, payment_id) WHERE (payment_line_id IS NOT NULL);
CREATE INDEX payment_refund_requests_payment_idx ON private.payment_refund_requests USING btree (payment_id);
CREATE UNIQUE INDEX payment_refund_requests_reference_idx ON private.payment_refund_requests USING btree (lower(ozow_reference));
CREATE INDEX payment_refund_requests_requested_by_idx ON private.payment_refund_requests USING btree (requested_by);
CREATE UNIQUE INDEX payment_refund_requests_waiting_idx ON private.payment_refund_requests USING btree (payment_id) WHERE (status = 'awaiting_approval'::text);
CREATE TRIGGER payment_refund_requests_guard BEFORE INSERT OR UPDATE ON private.payment_refund_requests FOR EACH ROW EXECUTE FUNCTION internal.payment_refund_request_guard();
CREATE TRIGGER payment_refund_requests_reference_rule BEFORE INSERT ON private.payment_refund_requests FOR EACH ROW EXECUTE FUNCTION internal.payment_refund_reference_rule();
revoke all on private.payment_refund_requests from public;
