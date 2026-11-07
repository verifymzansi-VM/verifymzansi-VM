-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.verification_current_submissions (
  case_id uuid not null,
  submission_id uuid not null,
  constraint verification_current_submissions_case_id_fkey FOREIGN KEY (case_id) REFERENCES private.evidence_cases(id),
  constraint verification_current_submissions_pkey PRIMARY KEY (case_id),
  constraint verification_current_submissions_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES private.verification_identity_submissions(id),
  constraint verification_current_submissions_submission_id_key UNIQUE (submission_id)
);
alter table private.verification_current_submissions owner to postgres;
alter table private.verification_current_submissions enable row level security;
revoke all on private.verification_current_submissions from public;
