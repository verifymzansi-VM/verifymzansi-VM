-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.event_submissions (
  id uuid default gen_random_uuid() not null,
  owner_id uuid not null,
  post_id uuid not null,
  submitted_at timestamp with time zone default statement_timestamp() not null,
  released_at timestamp with time zone,
  release_reason text,
  constraint event_submissions_check CHECK ((released_at IS NULL) = (release_reason IS NULL)),
  constraint event_submissions_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint event_submissions_pkey PRIMARY KEY (id),
  constraint event_submissions_release_reason_check CHECK (release_reason = 'owner_deleted'::text)
);
alter table private.event_submissions owner to postgres;
alter table private.event_submissions enable row level security;
CREATE INDEX event_submissions_age_idx ON private.event_submissions USING btree (submitted_at);
CREATE INDEX event_submissions_owner_idx ON private.event_submissions USING btree (owner_id, submitted_at);
CREATE INDEX event_submissions_post_idx ON private.event_submissions USING btree (post_id) WHERE (released_at IS NULL);
CREATE TRIGGER event_submission_guard BEFORE DELETE OR UPDATE ON private.event_submissions FOR EACH ROW EXECUTE FUNCTION internal.event_submission_guard();
revoke all on private.event_submissions from public;
