-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.identity_submission_names (
  submission_id uuid not null,
  owner_id uuid not null,
  legal_first_name text not null,
  legal_last_name text not null,
  constraint identity_submission_names_legal_first_name_check CHECK (internal.person_name_valid(legal_first_name)),
  constraint identity_submission_names_legal_last_name_check CHECK (internal.person_name_valid(legal_last_name)),
  constraint identity_submission_names_pkey PRIMARY KEY (submission_id),
  constraint identity_submission_names_submission_id_owner_id_fkey FOREIGN KEY (submission_id, owner_id) REFERENCES private.verification_identity_submissions(id, owner_id) ON DELETE CASCADE
);
alter table private.identity_submission_names owner to postgres;
alter table private.identity_submission_names enable row level security;
CREATE INDEX identity_submission_names_owner_idx ON private.identity_submission_names USING btree (owner_id);
CREATE TRIGGER identity_submission_names_immutable BEFORE UPDATE ON private.identity_submission_names FOR EACH ROW EXECUTE FUNCTION internal.identity_submission_names_immutable();
revoke all on private.identity_submission_names from public;
