-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.evidence_cases (
  id uuid default gen_random_uuid() not null,
  subject_id uuid not null,
  kind text not null,
  status text default 'open'::text not null,
  claimed_by uuid,
  claim_expires_at timestamp with time zone,
  claim_generation bigint default 0 not null,
  claim_nonce uuid,
  version integer default 1 not null,
  created_at timestamp with time zone default statement_timestamp() not null,
  constraint evidence_cases_check CHECK (claimed_by IS NULL AND claim_expires_at IS NULL AND claim_nonce IS NULL OR claimed_by IS NOT NULL AND claim_expires_at IS NOT NULL AND claim_nonce IS NOT NULL AND claim_generation > 0),
  constraint evidence_cases_check1 CHECK (status = 'open'::text OR claimed_by IS NULL),
  constraint evidence_cases_claim_generation_check CHECK (claim_generation >= 0),
  constraint evidence_cases_claimed_by_fkey FOREIGN KEY (claimed_by) REFERENCES auth.users(id) ON DELETE RESTRICT,
  constraint evidence_cases_id_subject_id_key UNIQUE (id, subject_id),
  constraint evidence_cases_kind_check CHECK (kind = ANY (ARRAY['kyc'::text, 'business'::text, 'restriction'::text])),
  constraint evidence_cases_pkey PRIMARY KEY (id),
  constraint evidence_cases_status_check CHECK (status = ANY (ARRAY['open'::text, 'decided'::text, 'closed'::text])),
  constraint evidence_cases_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES auth.users(id) ON DELETE RESTRICT,
  constraint evidence_cases_version_check CHECK (version > 0)
);
alter table private.evidence_cases owner to postgres;
alter table private.evidence_cases enable row level security;
CREATE INDEX evidence_cases_subject_idx ON private.evidence_cases USING btree (subject_id, id);
CREATE TRIGGER evidence_case_identity BEFORE UPDATE ON private.evidence_cases FOR EACH ROW EXECUTE FUNCTION internal.evidence_case_identity_guard();
CREATE TRIGGER evidence_decision_retention AFTER UPDATE OF status ON private.evidence_cases FOR EACH ROW WHEN (old.status = 'open'::text AND new.status = 'decided'::text) EXECUTE FUNCTION internal.evidence_decision_retention();
revoke all on private.evidence_cases from public;
