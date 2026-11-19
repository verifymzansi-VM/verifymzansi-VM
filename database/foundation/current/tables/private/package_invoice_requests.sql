-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.package_invoice_requests (
  id uuid default gen_random_uuid() not null,
  account_id uuid,
  member_request_id uuid not null,
  plan_version_id uuid not null,
  term_days integer not null,
  slots integer not null,
  unit_price_cents bigint not null,
  total_cents bigint not null,
  requested_at timestamp with time zone default statement_timestamp() not null,
  consent_at timestamp with time zone not null,
  consent_version text not null,
  consent_terms_version text,
  status text default 'requested'::text not null,
  due_days integer,
  staff_reason text,
  prepared_by uuid,
  prepared_at timestamp with time zone,
  approved_by uuid,
  approved_at timestamp with time zone,
  invoice_id uuid,
  closed_by uuid,
  closed_at timestamp with time zone,
  close_reason text,
  constraint package_invoice_requests_account_id_fkey FOREIGN KEY (account_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint package_invoice_requests_approved CHECK ((approved_by IS NULL) = (approved_at IS NULL) AND (approved_by IS NULL OR status = 'issued'::text AND approved_by <> prepared_by)),
  constraint package_invoice_requests_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES auth.users(id) ON DELETE RESTRICT,
  constraint package_invoice_requests_close_reason_check CHECK (close_reason IS NULL OR internal.plain_text_valid(close_reason, 5, 500, true)),
  constraint package_invoice_requests_closed_by_fkey FOREIGN KEY (closed_by) REFERENCES auth.users(id) ON DELETE RESTRICT,
  constraint package_invoice_requests_consent_version_check CHECK (consent_version = 'invoice-cooling-off-v1'::text),
  constraint package_invoice_requests_due_days_check CHECK (due_days IS NULL OR due_days >= 1 AND due_days <= 30),
  constraint package_invoice_requests_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES private.customer_invoices(id) ON DELETE CASCADE,
  constraint package_invoice_requests_invoice_key UNIQUE (invoice_id),
  constraint package_invoice_requests_member_request_key UNIQUE (account_id, member_request_id),
  constraint package_invoice_requests_not_own CHECK (prepared_by <> account_id AND approved_by <> account_id AND closed_by <> account_id),
  constraint package_invoice_requests_pkey PRIMARY KEY (id),
  constraint package_invoice_requests_plan_version_id_fkey FOREIGN KEY (plan_version_id) REFERENCES private.plan_versions(id) ON DELETE RESTRICT,
  constraint package_invoice_requests_prepared CHECK ((prepared_by IS NULL) = (prepared_at IS NULL) AND (prepared_by IS NULL) = (due_days IS NULL) AND (prepared_by IS NULL) = (staff_reason IS NULL)),
  constraint package_invoice_requests_prepared_by_fkey FOREIGN KEY (prepared_by) REFERENCES auth.users(id) ON DELETE RESTRICT,
  constraint package_invoice_requests_slots_check CHECK (slots >= 5 AND slots <= 250),
  constraint package_invoice_requests_staff_reason_check CHECK (staff_reason IS NULL OR internal.plain_text_valid(staff_reason, 5, 500, true)),
  constraint package_invoice_requests_states CHECK (
CASE status
    WHEN 'requested'::text THEN prepared_by IS NULL AND invoice_id IS NULL AND closed_at IS NULL AND closed_by IS NULL
    WHEN 'awaiting_approval'::text THEN prepared_by IS NOT NULL AND invoice_id IS NULL AND closed_at IS NULL AND closed_by IS NULL
    WHEN 'issued'::text THEN prepared_by IS NOT NULL AND invoice_id IS NOT NULL AND closed_at IS NULL AND closed_by IS NULL AND close_reason IS NULL
    WHEN 'declined'::text THEN invoice_id IS NULL AND approved_by IS NULL AND closed_at IS NOT NULL AND closed_by IS NOT NULL AND close_reason IS NOT NULL
    ELSE invoice_id IS NULL AND approved_by IS NULL AND closed_at IS NOT NULL AND closed_by IS NULL AND close_reason IS NULL
END),
  constraint package_invoice_requests_status_check CHECK (status = ANY (ARRAY['requested'::text, 'awaiting_approval'::text, 'issued'::text, 'declined'::text, 'withdrawn'::text])),
  constraint package_invoice_requests_term_days_check CHECK (term_days = ANY (ARRAY[30, 90, 180])),
  constraint package_invoice_requests_total CHECK (total_cents = (unit_price_cents * slots) AND total_cents <= 15000000),
  constraint package_invoice_requests_unit_price_cents_check CHECK (unit_price_cents >= 100 AND unit_price_cents <= 1000000)
);
alter table private.package_invoice_requests owner to postgres;
alter table private.package_invoice_requests enable row level security;
CREATE INDEX package_invoice_requests_account_idx ON private.package_invoice_requests USING btree (account_id, requested_at DESC);
CREATE INDEX package_invoice_requests_approved_by_idx ON private.package_invoice_requests USING btree (approved_by) WHERE (approved_by IS NOT NULL);
CREATE INDEX package_invoice_requests_closed_by_idx ON private.package_invoice_requests USING btree (closed_by) WHERE (closed_by IS NOT NULL);
CREATE UNIQUE INDEX package_invoice_requests_open_idx ON private.package_invoice_requests USING btree (account_id) WHERE (status = ANY (ARRAY['requested'::text, 'awaiting_approval'::text]));
CREATE INDEX package_invoice_requests_plan_version_idx ON private.package_invoice_requests USING btree (plan_version_id);
CREATE INDEX package_invoice_requests_prepared_by_idx ON private.package_invoice_requests USING btree (prepared_by) WHERE (prepared_by IS NOT NULL);
CREATE INDEX package_invoice_requests_queue_idx ON private.package_invoice_requests USING btree (requested_at, id) WHERE (status = ANY (ARRAY['requested'::text, 'awaiting_approval'::text]));
CREATE TRIGGER package_invoice_requests_guard BEFORE INSERT OR UPDATE ON private.package_invoice_requests FOR EACH ROW EXECUTE FUNCTION internal.package_invoice_request_guard();
revoke all on private.package_invoice_requests from public;
