-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.verification_return_requests (
  id uuid default gen_random_uuid() not null,
  case_id uuid not null,
  case_version integer not null,
  reason text not null,
  reviewer_id uuid not null,
  created_at timestamp with time zone default statement_timestamp() not null,
  decision text default 'needs_resubmission'::text not null,
  constraint verification_return_requests_case_id_fkey FOREIGN KEY (case_id) REFERENCES private.evidence_cases(id) ON DELETE RESTRICT,
  constraint verification_return_requests_case_version_check CHECK (case_version > 0),
  constraint verification_return_requests_decision_check CHECK (decision = ANY (ARRAY['rejected'::text, 'needs_resubmission'::text])),
  constraint verification_return_requests_pkey PRIMARY KEY (id),
  constraint verification_return_requests_reason_check CHECK (length(reason) >= 5 AND length(reason) <= 500),
  constraint verification_return_requests_reviewer_id_fkey FOREIGN KEY (reviewer_id) REFERENCES auth.users(id) ON DELETE RESTRICT
);
alter table private.verification_return_requests owner to postgres;
alter table private.verification_return_requests enable row level security;
CREATE INDEX verification_return_requests_case_idx ON private.verification_return_requests USING btree (case_id, created_at DESC);
revoke all on private.verification_return_requests from public;
