-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.customer_invoice_payments (
  payment_id uuid not null,
  invoice_id uuid not null,
  attempt integer not null,
  created_at timestamp with time zone default statement_timestamp() not null,
  constraint customer_invoice_payments_attempt_check CHECK (attempt >= 1 AND attempt <= 20),
  constraint customer_invoice_payments_attempt_key UNIQUE (invoice_id, attempt),
  constraint customer_invoice_payments_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES private.customer_invoices(id) ON DELETE RESTRICT,
  constraint customer_invoice_payments_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES private.payments(id) ON DELETE RESTRICT,
  constraint customer_invoice_payments_pkey PRIMARY KEY (payment_id)
);
alter table private.customer_invoice_payments owner to postgres;
alter table private.customer_invoice_payments enable row level security;
CREATE TRIGGER customer_invoice_payments_guard BEFORE INSERT OR DELETE OR UPDATE ON private.customer_invoice_payments FOR EACH ROW EXECUTE FUNCTION internal.customer_invoice_payment_guard();
revoke all on private.customer_invoice_payments from public;
