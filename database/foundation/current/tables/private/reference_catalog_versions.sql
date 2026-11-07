-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.reference_catalog_versions (
  version integer not null,
  content_hash text not null,
  created_at timestamp with time zone default statement_timestamp() not null,
  constraint reference_catalog_versions_content_hash_check CHECK (content_hash ~ '^[A-Za-z0-9_-]{43}$'::text),
  constraint reference_catalog_versions_content_hash_key UNIQUE (content_hash),
  constraint reference_catalog_versions_pkey PRIMARY KEY (version),
  constraint reference_catalog_versions_version_check CHECK (version > 0)
);
alter table private.reference_catalog_versions owner to postgres;
alter table private.reference_catalog_versions enable row level security;
revoke all on private.reference_catalog_versions from public;
