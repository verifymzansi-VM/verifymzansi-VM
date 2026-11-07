-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.payments (
  id uuid default gen_random_uuid() not null,
  owner_id uuid not null,
  product_kind text not null,
  plan_version_id uuid,
  addon_version_id uuid,
  target_post_id uuid,
  amount_cents bigint not null,
  currency text not null,
  snapshot jsonb not null,
  status text default 'pending'::text not null,
  fulfillment_status text default 'unfulfilled'::text not null,
  merchant_reference text default replace((gen_random_uuid())::text, '-'::text, ''::text) not null,
  provider text default 'ozow'::text not null,
  provider_request_id text,
  provider_transaction_id text,
  created_at timestamp with time zone default statement_timestamp() not null,
  completed_at timestamp with time zone,
  status_changed_at timestamp with time zone default statement_timestamp() not null,
  checkout_url text,
  checkout_expires_at timestamp with time zone,
  checkout_claim_token uuid,
  checkout_claim_until timestamp with time zone,
  provider_idempotency_key uuid default gen_random_uuid() not null,
  provider_correlation_id uuid default gen_random_uuid() not null,
  reconciliation_checked_at timestamp with time zone,
  constraint payments_addon_version_id_fkey FOREIGN KEY (addon_version_id) REFERENCES private.addon_versions(id),
  constraint payments_amount_cents_check CHECK (amount_cents > 0),
  constraint payments_check CHECK (product_kind = 'plan'::text AND plan_version_id IS NOT NULL AND addon_version_id IS NULL AND target_post_id IS NULL OR product_kind = 'addon'::text AND addon_version_id IS NOT NULL AND plan_version_id IS NULL AND target_post_id IS NOT NULL),
  constraint payments_check1 CHECK ((status = 'complete'::text) = (completed_at IS NOT NULL AND provider_transaction_id IS NOT NULL) OR (status = ANY (ARRAY['refunded'::text, 'chargeback'::text]))),
  constraint payments_check2 CHECK (status <> 'complete'::text OR fulfillment_status <> 'unfulfilled'::text),
  constraint payments_checkout_url_https CHECK (checkout_url IS NULL OR length(checkout_url) >= 10 AND length(checkout_url) <= 4096 AND checkout_url ~ '^https://'::text),
  constraint payments_currency_check CHECK (currency = 'ZAR'::text),
  constraint payments_fulfillment_status_check CHECK (fulfillment_status = ANY (ARRAY['unfulfilled'::text, 'fulfilled'::text, 'needs_reconciliation'::text, 'reversed'::text])),
  constraint payments_merchant_reference_key UNIQUE (merchant_reference),
  constraint payments_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE RESTRICT,
  constraint payments_pkey PRIMARY KEY (id),
  constraint payments_plan_version_id_fkey FOREIGN KEY (plan_version_id) REFERENCES private.plan_versions(id),
  constraint payments_product_kind_check CHECK (product_kind = ANY (ARRAY['plan'::text, 'addon'::text])),
  constraint payments_provider_check CHECK (provider = 'ozow'::text),
  constraint payments_provider_request_id_check CHECK (length(provider_request_id) >= 1 AND length(provider_request_id) <= 100),
  constraint payments_provider_request_id_key UNIQUE (provider_request_id),
  constraint payments_provider_transaction_id_check CHECK (length(provider_transaction_id) >= 1 AND length(provider_transaction_id) <= 100),
  constraint payments_provider_transaction_id_key UNIQUE (provider_transaction_id),
  constraint payments_snapshot_check CHECK (jsonb_typeof(snapshot) = 'object'::text),
  constraint payments_status_check CHECK (status = ANY (ARRAY['pending'::text, 'complete'::text, 'failed'::text, 'cancelled'::text, 'expired'::text, 'refunded'::text, 'chargeback'::text]))
);
alter table private.payments owner to postgres;
alter table private.payments enable row level security;
CREATE UNIQUE INDEX payments_one_pending_idx ON private.payments USING btree (owner_id, COALESCE(plan_version_id, addon_version_id), COALESCE(target_post_id, '00000000-0000-0000-0000-000000000000'::uuid)) WHERE (status = 'pending'::text);
CREATE INDEX payments_staff_recent_idx ON private.payments USING btree (created_at DESC, id DESC);
CREATE INDEX payments_staff_status_recent_idx ON private.payments USING btree (status, created_at DESC, id DESC);
CREATE TRIGGER payments_invoice_snapshot BEFORE INSERT ON private.payments FOR EACH ROW EXECUTE FUNCTION internal.payment_invoice_snapshot();
CREATE TRIGGER payments_partner_commission AFTER UPDATE OF status ON private.payments FOR EACH ROW WHEN (old.status IS DISTINCT FROM new.status) EXECUTE FUNCTION internal.payment_partner_commission();
CREATE TRIGGER payments_quote_immutable BEFORE UPDATE ON private.payments FOR EACH ROW EXECUTE FUNCTION internal.payment_quote_guard();
revoke all on private.payments from public;
