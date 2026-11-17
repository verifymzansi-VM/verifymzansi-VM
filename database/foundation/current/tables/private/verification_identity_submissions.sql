-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.verification_identity_submissions (
  id uuid default gen_random_uuid() not null,
  case_id uuid not null,
  owner_id uuid not null,
  case_version integer not null,
  id_artifact_id uuid not null,
  selfie_artifact_id uuid not null,
  identity_hmac text not null,
  identity_key_id text not null,
  protocol text default 'sa-id-hmac-sha256-v1'::text not null,
  number_ciphertext text,
  number_iv text,
  number_tag text,
  encryption_key_id text not null,
  receipt_id uuid not null,
  recipe text not null,
  risk_score integer not null,
  created_at timestamp with time zone default clock_timestamp() not null,
  number_erased_at timestamp with time zone,
  constraint verification_identity_submissions_case_id_owner_id_fkey FOREIGN KEY (case_id, owner_id) REFERENCES private.evidence_cases(id, subject_id),
  constraint verification_identity_submissions_case_version_check CHECK (case_version > 0),
  constraint verification_identity_submissions_check CHECK (id_artifact_id <> selfie_artifact_id),
  constraint verification_identity_submissions_encryption_key_id_check CHECK (encryption_key_id = 'identity-number-v1'::text),
  constraint verification_identity_submissions_id_artifact_id_fkey FOREIGN KEY (id_artifact_id) REFERENCES private.evidence_artifacts(id),
  constraint verification_identity_submissions_id_owner_id_key UNIQUE (id, owner_id),
  constraint verification_identity_submissions_identity_hmac_check CHECK (identity_hmac ~ '^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$'::text),
  constraint verification_identity_submissions_identity_key_id_check CHECK (identity_key_id = 'identity-match-v1'::text),
  constraint verification_identity_submissions_number_ciphertext_check CHECK (number_ciphertext ~ '^[a-f0-9]{26}$'::text),
  constraint verification_identity_submissions_number_iv_check CHECK (number_iv ~ '^[a-f0-9]{24}$'::text),
  constraint verification_identity_submissions_number_tag_check CHECK (number_tag ~ '^[a-f0-9]{32}$'::text),
  constraint verification_identity_submissions_pkey PRIMARY KEY (id),
  constraint verification_identity_submissions_protocol_check CHECK (protocol = 'sa-id-hmac-sha256-v1'::text),
  constraint verification_identity_submissions_receipt_id_key UNIQUE (receipt_id),
  constraint verification_identity_submissions_recipe_check CHECK (recipe = 'manual-id-selfie-v1'::text),
  constraint verification_identity_submissions_risk_score_check CHECK (risk_score >= 0 AND risk_score <= 100),
  constraint verification_identity_submissions_selfie_artifact_id_fkey FOREIGN KEY (selfie_artifact_id) REFERENCES private.evidence_artifacts(id),
  constraint verification_submission_number_erasure CHECK (number_erased_at IS NULL AND number_ciphertext IS NOT NULL AND number_iv IS NOT NULL AND number_tag IS NOT NULL OR number_erased_at IS NOT NULL AND number_ciphertext IS NULL AND number_iv IS NULL AND number_tag IS NULL)
);
alter table private.verification_identity_submissions owner to postgres;
alter table private.verification_identity_submissions enable row level security;
CREATE INDEX verification_identity_submissions_id_artifact_id_idx ON private.verification_identity_submissions USING btree (id_artifact_id);
CREATE INDEX verification_identity_submissions_selfie_artifact_id_idx ON private.verification_identity_submissions USING btree (selfie_artifact_id);
CREATE INDEX verification_submissions_case_idx ON private.verification_identity_submissions USING btree (case_id, id);
CREATE INDEX verification_submissions_owner_idx ON private.verification_identity_submissions USING btree (owner_id, id);
CREATE TRIGGER snapshot_identity_submission_names AFTER INSERT ON private.verification_identity_submissions FOR EACH ROW EXECUTE FUNCTION internal.snapshot_identity_submission_names();
CREATE TRIGGER verification_submission_immutable BEFORE UPDATE ON private.verification_identity_submissions FOR EACH ROW EXECUTE FUNCTION internal.verification_submission_immutable();
revoke all on private.verification_identity_submissions from public;
