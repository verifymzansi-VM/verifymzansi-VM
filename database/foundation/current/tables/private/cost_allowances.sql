-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.cost_allowances (
  metric text not null,
  label text not null,
  unit text not null,
  free_quantity numeric,
  period text not null,
  provider text not null,
  overage_note text not null,
  measured_in_database boolean not null,
  measurement text default 'database_observation'::text not null,
  billing_scope text default 'unverified'::text not null,
  source_url text,
  verified_on date,
  constraint cost_allowances_billing_scope_check CHECK (billing_scope = ANY (ARRAY['unverified'::text, 'account'::text, 'organization'::text, 'project'::text, 'contract'::text])),
  constraint cost_allowances_free_quantity_check CHECK (free_quantity IS NULL OR free_quantity > 0::numeric),
  constraint cost_allowances_label_check CHECK (length(label) >= 3 AND length(label) <= 120),
  constraint cost_allowances_measurement_check CHECK (measurement = ANY (ARRAY['database_observation'::text, 'estimate'::text, 'provider_required'::text])),
  constraint cost_allowances_metric_check CHECK (metric ~ '^[a-z_]+$'::text),
  constraint cost_allowances_overage_note_check CHECK (length(overage_note) >= 3 AND length(overage_note) <= 300),
  constraint cost_allowances_period_check CHECK (period = ANY (ARRAY['current'::text, 'month'::text, 'day'::text])),
  constraint cost_allowances_pkey PRIMARY KEY (metric),
  constraint cost_allowances_provider_check CHECK (length(provider) >= 2 AND length(provider) <= 60),
  constraint cost_allowances_source_url_check CHECK (source_url IS NULL OR source_url ~ '^https://'::text),
  constraint cost_allowances_unit_check CHECK (unit = ANY (ARRAY['bytes'::text, 'count'::text]))
);
alter table private.cost_allowances owner to postgres;
alter table private.cost_allowances enable row level security;
revoke all on private.cost_allowances from public;
