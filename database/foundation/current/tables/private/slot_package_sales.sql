-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.slot_package_sales (
  singleton boolean default true not null,
  on_sale boolean default false not null,
  changed_at timestamp with time zone default statement_timestamp() not null,
  reason text not null,
  constraint slot_package_sales_pkey PRIMARY KEY (singleton),
  constraint slot_package_sales_reason_check CHECK (length(btrim(reason)) >= 5 AND length(btrim(reason)) <= 500),
  constraint slot_package_sales_singleton_check CHECK (singleton)
);
alter table private.slot_package_sales owner to postgres;
alter table private.slot_package_sales enable row level security;
revoke all on private.slot_package_sales from public;
