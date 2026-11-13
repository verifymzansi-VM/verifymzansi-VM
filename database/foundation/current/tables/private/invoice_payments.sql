-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.invoice_payments (
  payment_id uuid not null,
  account_id uuid not null,
  bank_reference text not null,
  amount_received_cents bigint not null,
  cleared_on date not null,
  cooling_off_waiver_confirmed boolean not null,
  reason text not null,
  recorded_by uuid not null,
  recorded_at timestamp with time zone default statement_timestamp() not null,
  constraint invoice_payments_account_id_fkey FOREIGN KEY (account_id) REFERENCES auth.users(id) ON DELETE RESTRICT,
  constraint invoice_payments_amount_received_cents_check CHECK (amount_received_cents > 0 AND amount_received_cents <= 5000000),
  constraint invoice_payments_bank_reference_check CHECK (bank_reference ~ '^[A-Za-z0-9][A-Za-z0-9 ._:/-]{3,59}$'::text AND bank_reference = btrim(bank_reference) AND bank_reference !~ '  '::text AND length(regexp_replace(bank_reference, '[^A-Za-z0-9]'::text, ''::text, 'g'::text)) >= 4),
  constraint invoice_payments_cooling_off_waiver_confirmed_check CHECK (cooling_off_waiver_confirmed),
  constraint invoice_payments_not_own CHECK (recorded_by <> account_id),
  constraint invoice_payments_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES private.payments(id) ON DELETE RESTRICT,
  constraint invoice_payments_pkey PRIMARY KEY (payment_id),
  constraint invoice_payments_reason_check CHECK (internal.plain_text_valid(reason, 5, 500, true)),
  constraint invoice_payments_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES auth.users(id) ON DELETE RESTRICT
);
alter table private.invoice_payments owner to postgres;
alter table private.invoice_payments enable row level security;
CREATE INDEX invoice_payments_account_idx ON private.invoice_payments USING btree (account_id);
CREATE INDEX invoice_payments_recorded_by_idx ON private.invoice_payments USING btree (recorded_by);
CREATE UNIQUE INDEX invoice_payments_reference_idx ON private.invoice_payments USING btree (upper(regexp_replace(bank_reference, '[^A-Za-z0-9]'::text, ''::text, 'g'::text)));
CREATE TRIGGER invoice_payments_guard BEFORE INSERT OR DELETE OR UPDATE ON private.invoice_payments FOR EACH ROW EXECUTE FUNCTION internal.invoice_payment_guard();
revoke all on private.invoice_payments from public;
