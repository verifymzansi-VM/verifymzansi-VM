-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.frontend_cipc_exceptions (
  check_id uuid not null,
  official_file uuid not null,
  proposed_by uuid not null,
  reason text not null,
  proposed_at timestamp with time zone default clock_timestamp() not null,
  confirmed_by uuid,
  confirmed_at timestamp with time zone,
  constraint frontend_cipc_exceptions_check CHECK (confirmed_by IS NULL OR confirmed_by <> proposed_by),
  constraint frontend_cipc_exceptions_check_id_fkey FOREIGN KEY (check_id) REFERENCES private.frontend_cipc_reviews(check_id) ON DELETE CASCADE,
  constraint frontend_cipc_exceptions_confirmed_by_fkey FOREIGN KEY (confirmed_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  constraint frontend_cipc_exceptions_official_file_fkey FOREIGN KEY (official_file) REFERENCES private.evidence_artifacts(id) ON DELETE CASCADE,
  constraint frontend_cipc_exceptions_pkey PRIMARY KEY (check_id),
  constraint frontend_cipc_exceptions_proposed_by_fkey FOREIGN KEY (proposed_by) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint frontend_cipc_exceptions_reason_check CHECK (length(reason) >= 10 AND length(reason) <= 1000)
);
alter table private.frontend_cipc_exceptions owner to postgres;
alter table private.frontend_cipc_exceptions enable row level security;
CREATE INDEX frontend_cipc_exception_confirmer_idx ON private.frontend_cipc_exceptions USING btree (confirmed_by);
CREATE INDEX frontend_cipc_exception_file_idx ON private.frontend_cipc_exceptions USING btree (official_file);
CREATE INDEX frontend_cipc_exception_proposer_idx ON private.frontend_cipc_exceptions USING btree (proposed_by);
revoke all on private.frontend_cipc_exceptions from public;
