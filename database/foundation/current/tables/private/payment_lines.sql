-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.payment_lines (
  id uuid default gen_random_uuid() not null,
  payment_id uuid not null,
  line_number integer not null,
  plan_version_id uuid not null,
  amount_cents bigint not null,
  status text default 'open'::text not null,
  reversal_kind text,
  reversal_reason text,
  reversed_at timestamp with time zone,
  reversed_by uuid,
  created_at timestamp with time zone default statement_timestamp() not null,
  constraint payment_lines_amount_cents_check CHECK (amount_cents >= 100 AND amount_cents <= 1000000),
  constraint payment_lines_id_payment_key UNIQUE (id, payment_id),
  constraint payment_lines_line_number_check CHECK (line_number >= 1 AND line_number <= 25),
  constraint payment_lines_number_key UNIQUE (payment_id, line_number),
  constraint payment_lines_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES private.payments(id) ON DELETE CASCADE,
  constraint payment_lines_pkey PRIMARY KEY (id),
  constraint payment_lines_plan_version_id_fkey FOREIGN KEY (plan_version_id) REFERENCES private.plan_versions(id) ON DELETE RESTRICT,
  constraint payment_lines_reversal CHECK ((status = 'reversed'::text) = (reversal_kind IS NOT NULL AND reversal_reason IS NOT NULL AND reversed_at IS NOT NULL)),
  constraint payment_lines_reversal_kind_check CHECK (reversal_kind = ANY (ARRAY['refunded'::text, 'chargeback'::text])),
  constraint payment_lines_reversal_reason_check CHECK (length(btrim(reversal_reason)) >= 5 AND length(btrim(reversal_reason)) <= 500),
  constraint payment_lines_reversed_by CHECK (reversed_by IS NULL OR status = 'reversed'::text),
  constraint payment_lines_reversed_by_fkey FOREIGN KEY (reversed_by) REFERENCES auth.users(id) ON DELETE RESTRICT,
  constraint payment_lines_status_check CHECK (status = ANY (ARRAY['open'::text, 'reversed'::text]))
);
alter table private.payment_lines owner to postgres;
alter table private.payment_lines enable row level security;
CREATE INDEX payment_lines_plan_version_idx ON private.payment_lines USING btree (plan_version_id);
CREATE INDEX payment_lines_reversed_by_idx ON private.payment_lines USING btree (reversed_by) WHERE (reversed_by IS NOT NULL);
CREATE TRIGGER payment_lines_immutable BEFORE UPDATE ON private.payment_lines FOR EACH ROW EXECUTE FUNCTION internal.payment_line_guard();
CREATE TRIGGER payment_lines_refund_waiting BEFORE UPDATE OF status ON private.payment_lines FOR EACH ROW WHEN (new.status = 'reversed'::text AND old.status = 'open'::text) EXECUTE FUNCTION internal.payment_reversal_waiting_guard();
revoke all on private.payment_lines from public;
