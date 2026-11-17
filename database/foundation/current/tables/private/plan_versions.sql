-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.plan_versions (
  id uuid default gen_random_uuid() not null,
  plan_code text not null,
  version integer not null,
  area text,
  label text not null,
  price_cents bigint not null,
  currency text default 'ZAR'::text not null,
  duration_days integer not null,
  slot_capacity integer not null,
  activations_per_period integer,
  activation_period_days integer default 30 not null,
  max_photos integer not null,
  max_videos integer not null,
  addon_capabilities text[] default '{}'::text[] not null,
  is_public boolean default true not null,
  created_at timestamp with time zone default statement_timestamp() not null,
  retired_at timestamp with time zone,
  constraint plan_versions_activation_period_days_check CHECK (activation_period_days >= 1 AND activation_period_days <= 366),
  constraint plan_versions_activations_per_period_check CHECK (activations_per_period >= 1 AND activations_per_period <= 10000),
  constraint plan_versions_addon_capabilities_check CHECK (
CASE
    WHEN COALESCE(array_ndims(addon_capabilities), 1) <> 1 THEN false
    ELSE addon_capabilities <@ ARRAY['boost'::text, 'featured'::text, 'urgent'::text] AND array_position(addon_capabilities, NULL::text) IS NULL AND cardinality(addon_capabilities) = (('boost'::text = ANY (addon_capabilities))::integer + ('featured'::text = ANY (addon_capabilities))::integer + ('urgent'::text = ANY (addon_capabilities))::integer)
END),
  constraint plan_versions_area_check CHECK (area = ANY (ARRAY['market'::text, 'business'::text, 'tourism_events'::text])),
  constraint plan_versions_currency_check CHECK (currency = 'ZAR'::text),
  constraint plan_versions_duration_days_check CHECK (duration_days >= 1 AND duration_days <= 366),
  constraint plan_versions_label_check CHECK (length(label) >= 1 AND length(label) <= 120),
  constraint plan_versions_max_photos_check CHECK (max_photos >= 1 AND max_photos <= 50),
  constraint plan_versions_max_videos_check CHECK (max_videos >= 0 AND max_videos <= 10),
  constraint plan_versions_pkey PRIMARY KEY (id),
  constraint plan_versions_plan_code_check CHECK (plan_code ~ '^[a-z][a-z0-9_]{0,59}$'::text),
  constraint plan_versions_plan_code_version_key UNIQUE (plan_code, version),
  constraint plan_versions_price_cents_check CHECK (price_cents >= 100 AND price_cents <= 100000000),
  constraint plan_versions_slot_capacity_check CHECK (slot_capacity >= 1 AND slot_capacity <= 1000),
  constraint plan_versions_version_check CHECK (version > 0)
);
alter table private.plan_versions owner to postgres;
alter table private.plan_versions enable row level security;
CREATE TRIGGER plan_versions_immutable BEFORE DELETE OR UPDATE ON private.plan_versions FOR EACH ROW EXECUTE FUNCTION internal.catalogue_version_guard();
revoke all on private.plan_versions from public;
