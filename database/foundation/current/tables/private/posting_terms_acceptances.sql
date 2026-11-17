-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.posting_terms_acceptances (
  owner_id uuid not null,
  version text not null,
  document_hash text not null,
  accepted_at timestamp with time zone default clock_timestamp() not null,
  constraint posting_terms_acceptances_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint posting_terms_acceptances_pkey PRIMARY KEY (owner_id, version),
  constraint posting_terms_acceptances_version_document_hash_fkey FOREIGN KEY (version, document_hash) REFERENCES private.posting_terms_versions(version, document_hash)
);
alter table private.posting_terms_acceptances owner to postgres;
alter table private.posting_terms_acceptances enable row level security;
CREATE TRIGGER posting_terms_acceptance_immutable BEFORE UPDATE ON private.posting_terms_acceptances FOR EACH ROW EXECUTE FUNCTION internal.guard_posting_terms_document();
revoke all on private.posting_terms_acceptances from public;
