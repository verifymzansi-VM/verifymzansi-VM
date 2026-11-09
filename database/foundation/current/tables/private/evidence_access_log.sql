-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.evidence_access_log (
  id bigint generated always as identity not null,
  staff_id uuid not null,
  case_id uuid not null,
  purpose text not null,
  case_version integer not null,
  claim_generation bigint not null,
  artifact_ids uuid[] not null,
  accessed_at timestamp with time zone default statement_timestamp() not null,
  identity_fact_ids uuid[] default '{}'::uuid[] not null,
  constraint evidence_access_log_case_id_fkey FOREIGN KEY (case_id) REFERENCES private.evidence_cases(id) ON DELETE RESTRICT,
  constraint evidence_access_log_case_version_check CHECK (case_version > 0),
  constraint evidence_access_log_claim_generation_check CHECK (claim_generation > 0),
  constraint evidence_access_log_pkey PRIMARY KEY (id),
  constraint evidence_access_log_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES auth.users(id) ON DELETE RESTRICT
);
alter table private.evidence_access_log owner to postgres;
alter table private.evidence_access_log enable row level security;
CREATE INDEX evidence_access_audit_time_idx ON private.evidence_access_log USING btree (accessed_at DESC, id DESC);
CREATE TRIGGER evidence_access_log_append_only BEFORE DELETE OR UPDATE ON private.evidence_access_log FOR EACH ROW EXECUTE FUNCTION internal.append_only_guard();
CREATE TRIGGER evidence_access_log_no_truncate BEFORE TRUNCATE ON private.evidence_access_log FOR EACH STATEMENT EXECUTE FUNCTION internal.append_only_guard();
revoke all on private.evidence_access_log from public;
