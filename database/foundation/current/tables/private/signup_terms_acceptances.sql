-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.signup_terms_acceptances (
  account_id uuid not null,
  version text not null,
  document_hash text not null,
  method text not null,
  accepted_at timestamp with time zone default clock_timestamp() not null,
  constraint signup_terms_acceptances_account_id_fkey FOREIGN KEY (account_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint signup_terms_acceptances_document_fkey FOREIGN KEY (version, document_hash) REFERENCES private.posting_terms_versions(version, document_hash),
  constraint signup_terms_acceptances_method_check CHECK (method = ANY (ARRAY['email_form'::text, 'google'::text])),
  constraint signup_terms_acceptances_pkey PRIMARY KEY (account_id)
);
alter table private.signup_terms_acceptances owner to postgres;
alter table private.signup_terms_acceptances enable row level security;
CREATE INDEX signup_terms_acceptances_document_idx ON private.signup_terms_acceptances USING btree (version, document_hash);
CREATE TRIGGER signup_terms_acceptances_immutable BEFORE DELETE OR UPDATE ON private.signup_terms_acceptances FOR EACH ROW EXECUTE FUNCTION internal.guard_consent_record();
revoke all on private.signup_terms_acceptances from public;
