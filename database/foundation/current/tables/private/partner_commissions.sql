-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.partner_commissions (
  id uuid default gen_random_uuid() not null,
  partner_id uuid not null,
  payment_id uuid not null,
  referred_account_id uuid not null,
  base_cents bigint not null,
  rate_bps integer not null,
  amount_cents bigint not null,
  status text default 'pending'::text not null,
  eligible_at timestamp with time zone not null,
  approved_at timestamp with time zone,
  approved_by uuid,
  paid_at timestamp with time zone,
  paid_by uuid,
  paid_reference text,
  reversed_at timestamp with time zone,
  reversed_by uuid,
  reversal_reason text,
  created_at timestamp with time zone default statement_timestamp() not null,
  payment_line_id uuid,
  constraint partner_commissions_amount_cents_check CHECK (amount_cents >= 0),
  constraint partner_commissions_base_cents_check CHECK (base_cents > 0),
  constraint partner_commissions_check CHECK (amount_cents::numeric = floor(base_cents::numeric * rate_bps::numeric / 10000::numeric)),
  constraint partner_commissions_check1 CHECK (((status = ANY (ARRAY['approved'::text, 'paid'::text])) OR status = 'reversed'::text AND approved_at IS NOT NULL) = (approved_at IS NOT NULL)),
  constraint partner_commissions_check2 CHECK ((paid_at IS NULL) = (paid_by IS NULL) AND (paid_at IS NULL) = (paid_reference IS NULL)),
  constraint partner_commissions_check3 CHECK (status <> 'paid'::text OR paid_at IS NOT NULL),
  constraint partner_commissions_check4 CHECK (status = 'reversed'::text OR (paid_at IS NULL) = (status <> 'paid'::text)),
  constraint partner_commissions_check5 CHECK ((status = 'reversed'::text) = (reversed_at IS NOT NULL AND reversal_reason IS NOT NULL)),
  constraint partner_commissions_paid_reference_check CHECK (paid_reference IS NULL OR internal.plain_text_valid(paid_reference, 3, 120, false)),
  constraint partner_commissions_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES private.partners(id) ON DELETE RESTRICT,
  constraint partner_commissions_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES private.payments(id) ON DELETE RESTRICT,
  constraint partner_commissions_payment_line_id_fkey FOREIGN KEY (payment_line_id) REFERENCES private.payment_lines(id) ON DELETE RESTRICT,
  constraint partner_commissions_pkey PRIMARY KEY (id),
  constraint partner_commissions_rate_bps_check CHECK (rate_bps >= 0 AND rate_bps <= 5000),
  constraint partner_commissions_referred_account_id_fkey FOREIGN KEY (referred_account_id) REFERENCES auth.users(id) ON DELETE RESTRICT,
  constraint partner_commissions_reversal_reason_check CHECK (reversal_reason IS NULL OR internal.plain_text_valid(reversal_reason, 5, 500, true)),
  constraint partner_commissions_status_check CHECK (status = ANY (ARRAY['pending'::text, 'approved'::text, 'paid'::text, 'reversed'::text]))
);
alter table private.partner_commissions owner to postgres;
alter table private.partner_commissions enable row level security;
CREATE INDEX partner_commissions_due_idx ON private.partner_commissions USING btree (eligible_at) WHERE (status = 'pending'::text);
CREATE INDEX partner_commissions_partner_idx ON private.partner_commissions USING btree (partner_id, created_at DESC, id DESC);
CREATE INDEX partner_commissions_payment_id_idx ON private.partner_commissions USING btree (payment_id);
CREATE UNIQUE INDEX partner_commissions_payment_line_idx ON private.partner_commissions USING btree (payment_line_id) WHERE (payment_line_id IS NOT NULL);
CREATE UNIQUE INDEX partner_commissions_payment_unlined_idx ON private.partner_commissions USING btree (payment_id) WHERE (payment_line_id IS NULL);
CREATE INDEX partner_commissions_referred_idx ON private.partner_commissions USING btree (referred_account_id);
CREATE TRIGGER partner_commissions_guard BEFORE UPDATE ON private.partner_commissions FOR EACH ROW EXECUTE FUNCTION internal.partner_commission_guard();
revoke all on private.partner_commissions from public;
