-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.invoice_transfers (
  id uuid default gen_random_uuid() not null,
  account_id uuid not null,
  plan_version_id uuid not null,
  slots integer not null,
  amount_received_cents bigint not null,
  bank_reference text not null,
  cleared_on date not null,
  cooling_off_waiver_confirmed boolean not null,
  reason text not null,
  recorded_by uuid not null,
  recorded_at timestamp with time zone default statement_timestamp() not null,
  status text default 'awaiting_confirmation'::text not null,
  confirmed_by uuid,
  confirmed_at timestamp with time zone,
  payment_id uuid,
  declined_by uuid,
  declined_at timestamp with time zone,
  decline_reason text,
  constraint invoice_transfers_account_id_fkey FOREIGN KEY (account_id) REFERENCES auth.users(id) ON DELETE RESTRICT,
  constraint invoice_transfers_amount_received_cents_check CHECK (amount_received_cents > 0 AND amount_received_cents <= 5000000),
  constraint invoice_transfers_bank_reference_check CHECK (bank_reference ~ '^[A-Za-z0-9][A-Za-z0-9 ._:/-]{3,59}$'::text AND bank_reference = btrim(bank_reference) AND bank_reference !~ '  '::text AND length(regexp_replace(bank_reference, '[^A-Za-z0-9]'::text, ''::text, 'g'::text)) >= 4),
  constraint invoice_transfers_confirmed CHECK ((status = 'confirmed'::text) = (confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL AND payment_id IS NOT NULL)),
  constraint invoice_transfers_confirmed_by_fkey FOREIGN KEY (confirmed_by) REFERENCES auth.users(id) ON DELETE RESTRICT,
  constraint invoice_transfers_confirmer CHECK (confirmed_by IS NULL OR confirmed_by <> recorded_by AND confirmed_by <> account_id),
  constraint invoice_transfers_cooling_off_waiver_confirmed_check CHECK (cooling_off_waiver_confirmed),
  constraint invoice_transfers_decline_reason_check CHECK (decline_reason IS NULL OR internal.plain_text_valid(decline_reason, 5, 500, true)),
  constraint invoice_transfers_declined CHECK ((status = 'declined'::text) = (declined_by IS NOT NULL AND declined_at IS NOT NULL AND decline_reason IS NOT NULL)),
  constraint invoice_transfers_declined_by_fkey FOREIGN KEY (declined_by) REFERENCES auth.users(id) ON DELETE RESTRICT,
  constraint invoice_transfers_not_own CHECK (recorded_by <> account_id),
  constraint invoice_transfers_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES private.payments(id) ON DELETE RESTRICT,
  constraint invoice_transfers_pkey PRIMARY KEY (id),
  constraint invoice_transfers_plan_version_id_fkey FOREIGN KEY (plan_version_id) REFERENCES private.plan_versions(id) ON DELETE RESTRICT,
  constraint invoice_transfers_reason_check CHECK (internal.plain_text_valid(reason, 5, 500, true)),
  constraint invoice_transfers_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES auth.users(id) ON DELETE RESTRICT,
  constraint invoice_transfers_slots_check CHECK (slots >= 1 AND slots <= 25),
  constraint invoice_transfers_status_check CHECK (status = ANY (ARRAY['awaiting_confirmation'::text, 'confirmed'::text, 'declined'::text]))
);
alter table private.invoice_transfers owner to postgres;
alter table private.invoice_transfers enable row level security;
CREATE INDEX invoice_transfers_account_idx ON private.invoice_transfers USING btree (account_id);
CREATE INDEX invoice_transfers_confirmed_by_idx ON private.invoice_transfers USING btree (confirmed_by) WHERE (confirmed_by IS NOT NULL);
CREATE INDEX invoice_transfers_declined_by_idx ON private.invoice_transfers USING btree (declined_by) WHERE (declined_by IS NOT NULL);
CREATE UNIQUE INDEX invoice_transfers_open_reference_idx ON private.invoice_transfers USING btree (upper(regexp_replace(bank_reference, '[^A-Za-z0-9]'::text, ''::text, 'g'::text)), amount_received_cents, cleared_on) WHERE (status <> 'declined'::text);
CREATE UNIQUE INDEX invoice_transfers_payment_idx ON private.invoice_transfers USING btree (payment_id) WHERE (payment_id IS NOT NULL);
CREATE INDEX invoice_transfers_plan_version_idx ON private.invoice_transfers USING btree (plan_version_id);
CREATE INDEX invoice_transfers_recorded_by_idx ON private.invoice_transfers USING btree (recorded_by);
CREATE INDEX invoice_transfers_waiting_idx ON private.invoice_transfers USING btree (recorded_at) WHERE (status = 'awaiting_confirmation'::text);
CREATE TRIGGER invoice_transfers_guard BEFORE INSERT OR DELETE OR UPDATE ON private.invoice_transfers FOR EACH ROW EXECUTE FUNCTION internal.invoice_transfer_guard();
revoke all on private.invoice_transfers from public;
