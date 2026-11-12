-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.accepted_identity_facts (
  id uuid default gen_random_uuid() not null,
  owner_id uuid not null,
  submission_id uuid not null,
  identity_hmac text not null,
  reviewed_by uuid not null,
  second_reviewer uuid,
  decision_id uuid,
  reviewed_at timestamp with time zone default clock_timestamp() not null,
  revoked_at timestamp with time zone,
  constraint accepted_identity_facts_check CHECK (owner_id <> reviewed_by AND owner_id IS DISTINCT FROM second_reviewer),
  constraint accepted_identity_facts_check1 CHECK ((second_reviewer IS NULL) = (decision_id IS NULL)),
  constraint accepted_identity_facts_check2 CHECK (second_reviewer IS DISTINCT FROM reviewed_by),
  constraint accepted_identity_facts_decision_id_fkey FOREIGN KEY (decision_id) REFERENCES private.decisions(id),
  constraint accepted_identity_facts_decision_id_key UNIQUE (decision_id),
  constraint accepted_identity_facts_identity_hmac_check CHECK (identity_hmac ~ '^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$'::text),
  constraint accepted_identity_facts_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE RESTRICT,
  constraint accepted_identity_facts_pkey PRIMARY KEY (id),
  constraint accepted_identity_facts_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES auth.users(id),
  constraint accepted_identity_facts_second_reviewer_fkey FOREIGN KEY (second_reviewer) REFERENCES auth.users(id),
  constraint accepted_identity_facts_submission_id_key UNIQUE (submission_id),
  constraint accepted_identity_facts_submission_id_owner_id_fkey FOREIGN KEY (submission_id, owner_id) REFERENCES private.verification_identity_submissions(id, owner_id)
);
alter table private.accepted_identity_facts owner to postgres;
alter table private.accepted_identity_facts enable row level security;
CREATE INDEX accepted_identity_facts_reviewed_by_idx ON private.accepted_identity_facts USING btree (reviewed_by);
CREATE INDEX accepted_identity_facts_second_reviewer_idx ON private.accepted_identity_facts USING btree (second_reviewer) WHERE (second_reviewer IS NOT NULL);
CREATE UNIQUE INDEX accepted_identity_fingerprint_active_idx ON private.accepted_identity_facts USING btree (identity_hmac) WHERE (revoked_at IS NULL);
CREATE INDEX accepted_identity_history_owner_idx ON private.accepted_identity_facts USING btree (owner_id, reviewed_at DESC, id DESC);
CREATE UNIQUE INDEX accepted_identity_owner_active_idx ON private.accepted_identity_facts USING btree (owner_id) WHERE (revoked_at IS NULL);
CREATE TRIGGER lock_reviewed_legal_name AFTER INSERT ON private.accepted_identity_facts FOR EACH ROW EXECUTE FUNCTION internal.lock_reviewed_legal_name();
CREATE TRIGGER verification_identity_fact_guard BEFORE UPDATE ON private.accepted_identity_facts FOR EACH ROW EXECUTE FUNCTION internal.verification_identity_fact_guard();
revoke all on private.accepted_identity_facts from public;
