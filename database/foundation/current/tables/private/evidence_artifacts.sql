-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.evidence_artifacts (
  id uuid default gen_random_uuid() not null,
  case_id uuid not null,
  owner_id uuid not null,
  purpose text not null,
  object_key text not null,
  state text default 'intent'::text not null,
  sha256 text,
  size_bytes integer,
  created_at timestamp with time zone default statement_timestamp() not null,
  state_changed_at timestamp with time zone default statement_timestamp() not null,
  retain_until timestamp with time zone,
  deleted_at timestamp with time zone,
  content_sha256 text,
  cleanup_token uuid,
  cleanup_lease_until timestamp with time zone,
  constraint evidence_artifacts_case_id_owner_id_fkey FOREIGN KEY (case_id, owner_id) REFERENCES private.evidence_cases(id, subject_id) ON DELETE RESTRICT,
  constraint evidence_artifacts_check CHECK ((state = ANY (ARRAY['intent'::text, 'cleanup_required'::text, 'deleted'::text, 'rejected'::text])) OR sha256 IS NOT NULL),
  constraint evidence_artifacts_check1 CHECK ((state = 'deleted'::text) = (deleted_at IS NOT NULL)),
  constraint evidence_artifacts_content_sha256_check CHECK (content_sha256 ~ '^[a-f0-9]{64}$'::text),
  constraint evidence_artifacts_object_key_key UNIQUE (object_key),
  constraint evidence_artifacts_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE RESTRICT,
  constraint evidence_artifacts_pkey PRIMARY KEY (id),
  constraint evidence_artifacts_purpose_check CHECK (purpose = ANY (ARRAY['id_front'::text, 'id_back'::text, 'selfie'::text, 'proof_of_address'::text, 'registration'::text, 'business_visit_photo'::text, 'business_reply_attachment'::text])),
  constraint evidence_artifacts_sha256_check CHECK (sha256 ~ '^[a-f0-9]{64}$'::text),
  constraint evidence_artifacts_size_bytes_check CHECK (size_bytes >= 1 AND size_bytes <= 20000000),
  constraint evidence_artifacts_state_check CHECK (state = ANY (ARRAY['intent'::text, 'uploaded'::text, 'clean'::text, 'rejected'::text, 'cleanup_required'::text, 'deleted'::text]))
);
alter table private.evidence_artifacts owner to postgres;
alter table private.evidence_artifacts enable row level security;
CREATE INDEX evidence_artifacts_case_idx ON private.evidence_artifacts USING btree (case_id, id);
CREATE INDEX evidence_artifacts_due_idx ON private.evidence_artifacts USING btree (retain_until) WHERE (state = 'clean'::text);
CREATE INDEX evidence_artifacts_intent_idx ON private.evidence_artifacts USING btree (created_at) WHERE (state = 'intent'::text);
CREATE TRIGGER evidence_artifact_submission BEFORE INSERT OR DELETE OR UPDATE ON private.evidence_artifacts FOR EACH ROW EXECUTE FUNCTION internal.evidence_artifact_submission_guard();
CREATE TRIGGER evidence_artifact_transition BEFORE UPDATE ON private.evidence_artifacts FOR EACH ROW EXECUTE FUNCTION internal.evidence_artifact_transition_guard();
CREATE TRIGGER scrub_frontend_verification_receipt AFTER UPDATE OF state ON private.evidence_artifacts FOR EACH ROW EXECUTE FUNCTION internal.scrub_frontend_verification_receipt();
CREATE TRIGGER verification_evidence_invalidation AFTER INSERT OR DELETE OR UPDATE ON private.evidence_artifacts FOR EACH ROW EXECUTE FUNCTION internal.verification_evidence_invalidation();
revoke all on private.evidence_artifacts from public;
