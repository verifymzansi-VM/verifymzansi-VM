-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.invoices (
  id uuid default gen_random_uuid() not null,
  payment_id uuid not null,
  invoice_number text not null,
  amount_ex_vat_cents bigint not null,
  vat_cents bigint not null,
  total_cents bigint not null,
  description text not null,
  issued_at timestamp with time zone default statement_timestamp() not null,
  merchant_registration_status text,
  merchant_vat_number text,
  vat_rate_bps integer,
  constraint invoices_check CHECK ((amount_ex_vat_cents + vat_cents) = total_cents),
  constraint invoices_invoice_number_key UNIQUE (invoice_number),
  constraint invoices_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES private.payments(id) ON DELETE RESTRICT,
  constraint invoices_payment_id_key UNIQUE (payment_id),
  constraint invoices_pkey PRIMARY KEY (id)
);
alter table private.invoices owner to postgres;
alter table private.invoices enable row level security;
CREATE TRIGGER invoices_merchant_snapshot BEFORE INSERT ON private.invoices FOR EACH ROW EXECUTE FUNCTION internal.invoice_merchant_snapshot();
revoke all on private.invoices from public;
