-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.posting_terms_versions (
  version text not null,
  document_hash text not null,
  published_at timestamp with time zone default clock_timestamp() not null,
  constraint posting_terms_versions_document_hash_check CHECK (document_hash ~ '^[A-Za-z0-9_-]{43}$'::text),
  constraint posting_terms_versions_pkey PRIMARY KEY (version),
  constraint posting_terms_versions_version_check CHECK (version ~ '^[a-z0-9][a-z0-9-]{0,63}$'::text),
  constraint posting_terms_versions_version_document_hash_key UNIQUE (version, document_hash)
);
alter table private.posting_terms_versions owner to postgres;
alter table private.posting_terms_versions enable row level security;
CREATE TRIGGER posting_terms_document_immutable BEFORE DELETE OR UPDATE ON private.posting_terms_versions FOR EACH ROW EXECUTE FUNCTION internal.guard_posting_terms_document();
revoke all on private.posting_terms_versions from public;
