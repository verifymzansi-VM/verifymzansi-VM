-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.frontend_cipc_documents (
  artifact_id uuid not null,
  check_id uuid not null,
  actor_id uuid,
  source text not null,
  content_digest text not null,
  reviewed_version timestamp with time zone not null,
  claim_generation text,
  claim_nonce uuid,
  summary jsonb,
  owner_match_fingerprint text,
  owner_match_position text,
  recorded_at timestamp with time zone,
  constraint frontend_cipc_documents_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE SET NULL,
  constraint frontend_cipc_documents_artifact_id_fkey FOREIGN KEY (artifact_id) REFERENCES private.evidence_artifacts(id) ON DELETE CASCADE,
  constraint frontend_cipc_documents_check CHECK ((source = 'owner_upload'::text) = (claim_nonce IS NULL)),
  constraint frontend_cipc_documents_check1 CHECK ((claim_generation IS NULL) = (claim_nonce IS NULL)),
  constraint frontend_cipc_documents_check2 CHECK ((recorded_at IS NULL) = (summary IS NULL)),
  constraint frontend_cipc_documents_check_id_fkey FOREIGN KEY (check_id) REFERENCES private.frontend_cipc_reviews(check_id) ON DELETE CASCADE,
  constraint frontend_cipc_documents_check_id_source_content_digest_key UNIQUE (check_id, source, content_digest),
  constraint frontend_cipc_documents_claim_generation_check CHECK (claim_generation IS NULL OR claim_generation ~ '^[1-9][0-9]{0,18}$'::text),
  constraint frontend_cipc_documents_content_digest_check CHECK (content_digest ~ '^[0-9a-f]{64}$'::text),
  constraint frontend_cipc_documents_owner_match_fingerprint_check CHECK (owner_match_fingerprint IS NULL OR owner_match_fingerprint ~ '^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$'::text),
  constraint frontend_cipc_documents_owner_match_position_check CHECK (length(owner_match_position) >= 1 AND length(owner_match_position) <= 120),
  constraint frontend_cipc_documents_pkey PRIMARY KEY (artifact_id),
  constraint frontend_cipc_documents_source_check CHECK (source = ANY (ARRAY['owner_upload'::text, 'admin_copy'::text])),
  constraint frontend_cipc_documents_summary_check CHECK (summary IS NULL OR jsonb_typeof(summary) = 'object'::text AND octet_length(summary::text) <= 60000)
);
alter table private.frontend_cipc_documents owner to postgres;
alter table private.frontend_cipc_documents enable row level security;
CREATE INDEX frontend_cipc_documents_actor_idx ON private.frontend_cipc_documents USING btree (actor_id);
CREATE INDEX frontend_cipc_documents_case_idx ON private.frontend_cipc_documents USING btree (check_id);
revoke all on private.frontend_cipc_documents from public;
