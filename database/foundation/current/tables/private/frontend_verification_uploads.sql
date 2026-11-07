-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.frontend_verification_uploads (
  owner_id uuid not null,
  request_id uuid not null,
  session_id uuid not null,
  case_id uuid not null,
  case_version integer not null,
  purpose text not null,
  request_digest text not null,
  artifact_id uuid not null,
  id_request uuid,
  fingerprint text,
  encrypted_number jsonb,
  created_at timestamp with time zone default clock_timestamp() not null,
  expires_at timestamp with time zone default (clock_timestamp() + '24:00:00'::interval) not null,
  completed_at timestamp with time zone,
  submission_id uuid,
  constraint frontend_verification_uploads_artifact_id_fkey FOREIGN KEY (artifact_id) REFERENCES private.evidence_artifacts(id) ON DELETE CASCADE,
  constraint frontend_verification_uploads_artifact_id_key UNIQUE (artifact_id),
  constraint frontend_verification_uploads_case_id_owner_id_fkey FOREIGN KEY (case_id, owner_id) REFERENCES private.evidence_cases(id, subject_id) ON DELETE CASCADE,
  constraint frontend_verification_uploads_case_version_check CHECK (case_version > 0),
  constraint frontend_verification_uploads_check CHECK (expires_at > created_at),
  constraint frontend_verification_uploads_check1 CHECK (purpose = 'id_front'::text OR fingerprint IS NULL AND encrypted_number IS NULL),
  constraint frontend_verification_uploads_check2 CHECK ((fingerprint IS NULL) = (encrypted_number IS NULL)),
  constraint frontend_verification_uploads_fingerprint_check CHECK (fingerprint ~ '^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$'::text),
  constraint frontend_verification_uploads_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE RESTRICT,
  constraint frontend_verification_uploads_owner_id_id_request_fkey FOREIGN KEY (owner_id, id_request) REFERENCES private.frontend_verification_uploads(owner_id, request_id) ON DELETE CASCADE,
  constraint frontend_verification_uploads_pkey PRIMARY KEY (owner_id, request_id),
  constraint frontend_verification_uploads_purpose_check CHECK (purpose = ANY (ARRAY['id_front'::text, 'selfie'::text])),
  constraint frontend_verification_uploads_request_digest_check CHECK (request_digest ~ '^[a-f0-9]{64}$'::text),
  constraint frontend_verification_uploads_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES private.verification_identity_submissions(id) ON DELETE CASCADE
);
alter table private.frontend_verification_uploads owner to postgres;
alter table private.frontend_verification_uploads enable row level security;
CREATE INDEX frontend_verification_case_idx ON private.frontend_verification_uploads USING btree (owner_id, case_id, purpose, created_at DESC);
CREATE INDEX frontend_verification_upload_parent_idx ON private.frontend_verification_uploads USING btree (owner_id, id_request) WHERE (id_request IS NOT NULL);
revoke all on private.frontend_verification_uploads from public;
