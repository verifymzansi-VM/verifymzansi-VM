-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.categories (
  key text not null,
  kind text not null,
  area text not null,
  label text not null,
  activity_required boolean not null,
  sort_order integer not null,
  reference_version integer not null,
  constraint categories_area_check CHECK (area = ANY (ARRAY['market'::text, 'business'::text, 'tourism_events'::text])),
  constraint categories_check CHECK (kind = 'listing'::text AND area = 'market'::text OR kind = 'business'::text AND (area = ANY (ARRAY['business'::text, 'tourism_events'::text])) OR kind = 'event'::text AND area = 'tourism_events'::text),
  constraint categories_key_check CHECK (key ~ '^[a-z][a-z0-9_]{0,79}$'::text),
  constraint categories_key_kind_area_key UNIQUE (key, kind, area),
  constraint categories_kind_check CHECK (kind = ANY (ARRAY['listing'::text, 'business'::text, 'event'::text])),
  constraint categories_label_check CHECK (length(label) >= 1 AND length(label) <= 120),
  constraint categories_pkey PRIMARY KEY (key),
  constraint categories_reference_version_fkey FOREIGN KEY (reference_version) REFERENCES private.reference_catalog_versions(version)
);
alter table private.categories owner to postgres;
alter table private.categories enable row level security;
revoke all on private.categories from public;
