-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.cost_alarms (
  id uuid default gen_random_uuid() not null,
  metric text not null,
  level text not null,
  period text not null,
  used numeric not null,
  free_quantity numeric not null,
  raised_at timestamp with time zone default statement_timestamp() not null,
  acknowledged_by uuid,
  acknowledged_at timestamp with time zone,
  constraint cost_alarms_acknowledged_by_fkey FOREIGN KEY (acknowledged_by) REFERENCES auth.users(id) ON DELETE RESTRICT,
  constraint cost_alarms_check CHECK ((acknowledged_by IS NULL) = (acknowledged_at IS NULL)),
  constraint cost_alarms_free_quantity_check CHECK (free_quantity > 0::numeric),
  constraint cost_alarms_level_check CHECK (level = ANY (ARRAY['warning'::text, 'critical'::text])),
  constraint cost_alarms_metric_fkey FOREIGN KEY (metric) REFERENCES private.cost_allowances(metric) ON DELETE RESTRICT,
  constraint cost_alarms_metric_level_period_key UNIQUE (metric, level, period),
  constraint cost_alarms_period_check CHECK (period ~ '^[0-9]{4}-[0-9]{2}(-[0-9]{2})?$'::text),
  constraint cost_alarms_pkey PRIMARY KEY (id),
  constraint cost_alarms_used_check CHECK (used >= 0::numeric)
);
alter table private.cost_alarms owner to postgres;
alter table private.cost_alarms enable row level security;
CREATE INDEX cost_alarms_acknowledged_by_idx ON private.cost_alarms USING btree (acknowledged_by) WHERE (acknowledged_by IS NOT NULL);
revoke all on private.cost_alarms from public;
