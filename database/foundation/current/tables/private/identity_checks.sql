-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.identity_checks (
  id uuid default gen_random_uuid() not null,
  owner_id uuid not null,
  case_id uuid not null,
  status text default 'started'::text not null,
  session_id uuid,
  session_url text,
  id_artifact_id uuid,
  selfie_artifact_id uuid,
  submission_id uuid,
  reasons text[] default '{}'::text[] not null,
  created_at timestamp with time zone default clock_timestamp() not null,
  expires_at timestamp with time zone not null,
  finished_at timestamp with time zone,
  declined_at timestamp with time zone,
  provider_delete_due timestamp with time zone,
  provider_deleted_at timestamp with time zone,
  constraint identity_checks_case_fkey FOREIGN KEY (case_id, owner_id) REFERENCES private.evidence_cases(id, subject_id) ON DELETE RESTRICT,
  constraint identity_checks_declined_check CHECK ((status = 'declined'::text) = (declined_at IS NOT NULL)),
  constraint identity_checks_expires_check CHECK (expires_at = (created_at + '24:00:00'::interval)),
  constraint identity_checks_finished_check CHECK ((status = 'started'::text) = (finished_at IS NULL)),
  constraint identity_checks_id_artifact_fkey FOREIGN KEY (id_artifact_id) REFERENCES private.evidence_artifacts(id) ON DELETE RESTRICT,
  constraint identity_checks_pkey PRIMARY KEY (id),
  constraint identity_checks_provider_deleted_check CHECK (provider_deleted_at IS NULL OR session_id IS NOT NULL AND status <> 'started'::text),
  constraint identity_checks_reasons_check CHECK (reasons <@ ARRAY['provider_declined'::text, 'provider_in_review'::text, 'names_differ'::text, 'document_not_accepted'::text, 'id_number_invalid'::text, 'under_18'::text, 'banned'::text, 'duplicate'::text, 'high_risk'::text]),
  constraint identity_checks_selfie_artifact_fkey FOREIGN KEY (selfie_artifact_id) REFERENCES private.evidence_artifacts(id) ON DELETE RESTRICT,
  constraint identity_checks_session_check CHECK ((session_id IS NULL) = (session_url IS NULL) AND (session_url IS NULL OR session_url ~~ 'https://verify.didit.me/%'::text AND char_length(session_url) <= 500)),
  constraint identity_checks_session_id_key UNIQUE (session_id),
  constraint identity_checks_status_check CHECK (status = ANY (ARRAY['started'::text, 'unavailable'::text, 'not_finished'::text, 'approved'::text, 'with_staff'::text, 'declined'::text])),
  constraint identity_checks_submission_check CHECK ((submission_id IS NOT NULL) = (status = ANY (ARRAY['approved'::text, 'with_staff'::text, 'declined'::text]))),
  constraint identity_checks_submission_fkey FOREIGN KEY (submission_id, owner_id) REFERENCES private.verification_identity_submissions(id, owner_id) ON DELETE RESTRICT,
  constraint identity_checks_submission_id_key UNIQUE (submission_id)
);
alter table private.identity_checks owner to postgres;
alter table private.identity_checks enable row level security;
CREATE INDEX identity_checks_case_idx ON private.identity_checks USING btree (case_id, owner_id);
CREATE INDEX identity_checks_created_idx ON private.identity_checks USING btree (created_at);
CREATE INDEX identity_checks_delete_due_idx ON private.identity_checks USING btree (provider_delete_due) WHERE ((provider_delete_due IS NOT NULL) AND (provider_deleted_at IS NULL));
CREATE INDEX identity_checks_id_artifact_idx ON private.identity_checks USING btree (id_artifact_id) WHERE (id_artifact_id IS NOT NULL);
CREATE UNIQUE INDEX identity_checks_one_started_idx ON private.identity_checks USING btree (owner_id) WHERE (status = 'started'::text);
CREATE INDEX identity_checks_owner_idx ON private.identity_checks USING btree (owner_id, created_at DESC, id DESC);
CREATE INDEX identity_checks_selfie_artifact_idx ON private.identity_checks USING btree (selfie_artifact_id) WHERE (selfie_artifact_id IS NOT NULL);
CREATE INDEX identity_checks_submission_owner_idx ON private.identity_checks USING btree (submission_id, owner_id) WHERE (submission_id IS NOT NULL);
revoke all on private.identity_checks from public;
comment on table private.identity_checks is 'Automatic ID checks: one row per check at the independent verification partner, bound to the member''s open identity case. The partner sees only the random id. status records where the result was sent (approved, with_staff, declined); the identity tables keep the verification itself.';
