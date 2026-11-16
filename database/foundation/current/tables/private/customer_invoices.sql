-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.customer_invoices (
  id uuid default gen_random_uuid() not null,
  invoice_number text not null,
  invoice_year integer not null,
  sequence_number integer not null,
  account_id uuid not null,
  plan_version_id uuid not null,
  slots integer not null,
  unit_price_cents bigint not null,
  total_cents bigint not null,
  description text not null,
  issued_at timestamp with time zone default statement_timestamp() not null,
  due_on date not null,
  issued_by uuid not null,
  issue_reason text not null,
  request_id uuid not null,
  seller jsonb not null,
  buyer_name text,
  buyer_address text,
  buyer_registration_number text,
  buyer_saved_at timestamp with time zone,
  revision integer default 1 not null,
  cooling_off_consent_at timestamp with time zone,
  cooling_off_consent_version text,
  status text default 'issued'::text not null,
  payment_id uuid,
  paid_at timestamp with time zone,
  voided_by uuid,
  voided_at timestamp with time zone,
  void_reason text,
  constraint customer_invoices_account_id_fkey FOREIGN KEY (account_id) REFERENCES auth.users(id) ON DELETE RESTRICT,
  constraint customer_invoices_buyer CHECK ((buyer_name IS NULL) = (buyer_address IS NULL) AND (buyer_name IS NULL) = (buyer_saved_at IS NULL) AND (buyer_registration_number IS NULL OR buyer_name IS NOT NULL)),
  constraint customer_invoices_buyer_address_check CHECK (buyer_address IS NULL OR internal.plain_text_valid(buyer_address, 5, 300, true)),
  constraint customer_invoices_buyer_name_check CHECK (buyer_name IS NULL OR internal.plain_text_valid(buyer_name, 2, 160, false)),
  constraint customer_invoices_buyer_registration_number_check CHECK (buyer_registration_number IS NULL OR buyer_registration_number ~ '^[A-Za-z0-9][A-Za-z0-9 /.-]{1,39}$'::text),
  constraint customer_invoices_consent CHECK ((cooling_off_consent_at IS NULL) = (cooling_off_consent_version IS NULL)),
  constraint customer_invoices_cooling_off_consent_version_check CHECK (cooling_off_consent_version IS NULL OR cooling_off_consent_version = 'invoice-cooling-off-v1'::text),
  constraint customer_invoices_description_check CHECK (internal.plain_text_valid(description, 3, 200, false)),
  constraint customer_invoices_invoice_year_check CHECK (invoice_year >= 2026 AND invoice_year <= 9999),
  constraint customer_invoices_issue_reason_check CHECK (internal.plain_text_valid(issue_reason, 5, 500, true)),
  constraint customer_invoices_issued_by_fkey FOREIGN KEY (issued_by) REFERENCES auth.users(id) ON DELETE RESTRICT,
  constraint customer_invoices_not_own CHECK (issued_by <> account_id),
  constraint customer_invoices_number_format CHECK (invoice_number = ((('VM-'::text || invoice_year::text) || '-'::text) || lpad(sequence_number::text, 6, '0'::text))),
  constraint customer_invoices_number_key UNIQUE (invoice_number),
  constraint customer_invoices_paid CHECK ((status = 'paid'::text) = (payment_id IS NOT NULL AND paid_at IS NOT NULL)),
  constraint customer_invoices_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES private.payments(id) ON DELETE RESTRICT,
  constraint customer_invoices_payment_key UNIQUE (payment_id),
  constraint customer_invoices_pkey PRIMARY KEY (id),
  constraint customer_invoices_plan_version_id_fkey FOREIGN KEY (plan_version_id) REFERENCES private.plan_versions(id) ON DELETE RESTRICT,
  constraint customer_invoices_request_key UNIQUE (issued_by, request_id),
  constraint customer_invoices_revision_check CHECK (revision >= 1),
  constraint customer_invoices_seller_check CHECK (jsonb_typeof(seller) = 'object'::text),
  constraint customer_invoices_sequence_key UNIQUE (invoice_year, sequence_number),
  constraint customer_invoices_sequence_number_check CHECK (sequence_number >= 1 AND sequence_number <= 999999),
  constraint customer_invoices_slots_check CHECK (slots >= 1 AND slots <= 25),
  constraint customer_invoices_status_check CHECK (status = ANY (ARRAY['issued'::text, 'paid'::text, 'void'::text])),
  constraint customer_invoices_total CHECK (total_cents = (unit_price_cents * slots)),
  constraint customer_invoices_total_cents_check CHECK (total_cents > 0 AND total_cents <= 5000000),
  constraint customer_invoices_unit_price_cents_check CHECK (unit_price_cents >= 100 AND unit_price_cents <= 1000000),
  constraint customer_invoices_void CHECK ((status = 'void'::text) = (voided_by IS NOT NULL AND voided_at IS NOT NULL AND void_reason IS NOT NULL)),
  constraint customer_invoices_void_reason_check CHECK (void_reason IS NULL OR internal.plain_text_valid(void_reason, 5, 500, true)),
  constraint customer_invoices_voided_by_fkey FOREIGN KEY (voided_by) REFERENCES auth.users(id) ON DELETE RESTRICT
);
alter table private.customer_invoices owner to postgres;
alter table private.customer_invoices enable row level security;
CREATE INDEX customer_invoices_account_idx ON private.customer_invoices USING btree (account_id, issued_at DESC);
CREATE INDEX customer_invoices_issued_by_idx ON private.customer_invoices USING btree (issued_by);
CREATE INDEX customer_invoices_plan_version_idx ON private.customer_invoices USING btree (plan_version_id);
CREATE INDEX customer_invoices_recent_idx ON private.customer_invoices USING btree (issued_at DESC, id DESC);
CREATE INDEX customer_invoices_voided_by_idx ON private.customer_invoices USING btree (voided_by) WHERE (voided_by IS NOT NULL);
CREATE TRIGGER customer_invoices_guard BEFORE INSERT OR DELETE OR UPDATE ON private.customer_invoices FOR EACH ROW EXECUTE FUNCTION internal.customer_invoice_guard();
revoke all on private.customer_invoices from public;
