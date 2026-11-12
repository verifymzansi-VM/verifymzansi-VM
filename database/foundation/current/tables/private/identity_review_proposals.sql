-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.identity_review_proposals (
  decision_id uuid not null,
  submission_id uuid not null,
  reviewer_session uuid not null,
  reviewed_at timestamp with time zone default clock_timestamp() not null,
  constraint identity_review_proposals_decision_id_fkey FOREIGN KEY (decision_id) REFERENCES private.decisions(id),
  constraint identity_review_proposals_pkey PRIMARY KEY (decision_id),
  constraint identity_review_proposals_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES private.verification_identity_submissions(id)
);
alter table private.identity_review_proposals owner to postgres;
alter table private.identity_review_proposals enable row level security;
CREATE INDEX identity_review_proposals_submission_id_idx ON private.identity_review_proposals USING btree (submission_id);
revoke all on private.identity_review_proposals from public;
