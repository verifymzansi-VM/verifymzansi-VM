-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.frontend_identity_step_approvals (
  case_id uuid not null,
  submission_id uuid not null,
  artifact_id uuid not null,
  case_version integer not null,
  claim_generation bigint not null,
  claim_nonce_digest text not null,
  purpose text not null,
  reviewer_id uuid,
  reviewer_session uuid,
  matches boolean not null,
  reviewer_note text,
  override_reason text,
  approved_at timestamp with time zone default clock_timestamp() not null,
  final_result jsonb,
  acknowledge_until timestamp with time zone,
  constraint frontend_identity_step_approv_submission_id_claim_generatio_key UNIQUE (submission_id, claim_generation, artifact_id),
  constraint frontend_identity_step_approvals_artifact_id_fkey FOREIGN KEY (artifact_id) REFERENCES private.evidence_artifacts(id) ON DELETE CASCADE,
  constraint frontend_identity_step_approvals_case_id_fkey FOREIGN KEY (case_id) REFERENCES private.evidence_cases(id) ON DELETE CASCADE,
  constraint frontend_identity_step_approvals_case_version_check CHECK (case_version > 0),
  constraint frontend_identity_step_approvals_claim_generation_check CHECK (claim_generation > 0),
  constraint frontend_identity_step_approvals_claim_nonce_digest_check CHECK (claim_nonce_digest ~ '^[a-f0-9]{64}$'::text),
  constraint frontend_identity_step_approvals_final_result_check CHECK (final_result IS NULL OR jsonb_typeof(final_result) = 'object'::text AND octet_length(final_result::text) <= 4096),
  constraint frontend_identity_step_approvals_matches_check CHECK (matches),
  constraint frontend_identity_step_approvals_override_reason_check CHECK (override_reason IS NULL OR override_reason ~ '^[a-z][a-z0-9_]{2,99}$'::text),
  constraint frontend_identity_step_approvals_pkey PRIMARY KEY (submission_id, claim_generation, purpose),
  constraint frontend_identity_step_approvals_purpose_check CHECK (purpose = ANY (ARRAY['id_front'::text, 'selfie'::text])),
  constraint frontend_identity_step_approvals_reviewer_id_fkey FOREIGN KEY (reviewer_id) REFERENCES auth.users(id) ON DELETE SET NULL,
  constraint frontend_identity_step_approvals_reviewer_note_check CHECK (reviewer_note IS NULL OR length(reviewer_note) >= 1 AND length(reviewer_note) <= 2000),
  constraint frontend_identity_step_approvals_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES private.verification_identity_submissions(id) ON DELETE CASCADE
);
alter table private.frontend_identity_step_approvals owner to postgres;
alter table private.frontend_identity_step_approvals enable row level security;
CREATE INDEX frontend_identity_step_artifact_idx ON private.frontend_identity_step_approvals USING btree (artifact_id);
CREATE INDEX frontend_identity_step_case_idx ON private.frontend_identity_step_approvals USING btree (case_id, case_version, claim_generation);
CREATE INDEX frontend_identity_step_reviewer_idx ON private.frontend_identity_step_approvals USING btree (reviewer_id);
revoke all on private.frontend_identity_step_approvals from public;
