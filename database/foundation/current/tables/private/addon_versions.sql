-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.addon_versions (
  id uuid default gen_random_uuid() not null,
  kind text not null,
  version integer not null,
  days integer not null,
  price_cents bigint not null,
  currency text default 'ZAR'::text not null,
  created_at timestamp with time zone default statement_timestamp() not null,
  retired_at timestamp with time zone,
  constraint addon_versions_currency_check CHECK (currency = 'ZAR'::text),
  constraint addon_versions_days_check CHECK (days >= 1 AND days <= 90),
  constraint addon_versions_kind_check CHECK (kind = ANY (ARRAY['boost'::text, 'featured'::text, 'urgent'::text])),
  constraint addon_versions_kind_days_version_key UNIQUE (kind, days, version),
  constraint addon_versions_pkey PRIMARY KEY (id),
  constraint addon_versions_price_cents_check CHECK (price_cents >= 100 AND price_cents <= 10000000),
  constraint addon_versions_version_check CHECK (version > 0)
);
alter table private.addon_versions owner to postgres;
alter table private.addon_versions enable row level security;
CREATE TRIGGER addon_versions_immutable BEFORE DELETE OR UPDATE ON private.addon_versions FOR EACH ROW EXECUTE FUNCTION internal.catalogue_version_guard();
revoke all on private.addon_versions from public;
