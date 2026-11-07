-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.invoice_merchant_config (
  singleton boolean default true not null,
  registration_status text default 'undecided'::text not null,
  vat_number text,
  vat_rate_bps integer default 0 not null,
  confirmed_at timestamp with time zone,
  constraint invoice_merchant_config_check CHECK (registration_status = 'registered'::text AND length(btrim(COALESCE(vat_number, ''::text))) >= 5 AND length(btrim(COALESCE(vat_number, ''::text))) <= 30 AND vat_rate_bps > 0 OR registration_status <> 'registered'::text AND vat_number IS NULL AND vat_rate_bps = 0),
  constraint invoice_merchant_config_check1 CHECK ((registration_status = 'undecided'::text) = (confirmed_at IS NULL)),
  constraint invoice_merchant_config_pkey PRIMARY KEY (singleton),
  constraint invoice_merchant_config_registration_status_check CHECK (registration_status = ANY (ARRAY['undecided'::text, 'not_registered'::text, 'registered'::text])),
  constraint invoice_merchant_config_singleton_check CHECK (singleton),
  constraint invoice_merchant_config_vat_rate_bps_check CHECK (vat_rate_bps >= 0 AND vat_rate_bps <= 10000)
);
alter table private.invoice_merchant_config owner to postgres;
alter table private.invoice_merchant_config enable row level security;
revoke all on private.invoice_merchant_config from public;
