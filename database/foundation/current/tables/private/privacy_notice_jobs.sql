-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.privacy_notice_jobs (
  id uuid default gen_random_uuid() not null,
  request_id uuid not null,
  kind text not null,
  created_at timestamp with time zone default clock_timestamp() not null,
  delivered_at timestamp with time zone,
  attempts integer default 0 not null,
  next_attempt_at timestamp with time zone default clock_timestamp() not null,
  claim_token uuid,
  locked_until timestamp with time zone,
  constraint privacy_notice_jobs_attempts_check CHECK (attempts >= 0 AND attempts <= 10),
  constraint privacy_notice_jobs_check CHECK ((claim_token IS NULL) = (locked_until IS NULL)),
  constraint privacy_notice_jobs_kind_check CHECK (kind = ANY (ARRAY['submitted'::text, 'extended'::text, 'rejected'::text, 'completed'::text])),
  constraint privacy_notice_jobs_pkey PRIMARY KEY (id),
  constraint privacy_notice_jobs_request_id_fkey FOREIGN KEY (request_id) REFERENCES private.privacy_requests(id) ON DELETE CASCADE,
  constraint privacy_notice_jobs_request_id_kind_key UNIQUE (request_id, kind)
);
alter table private.privacy_notice_jobs owner to postgres;
alter table private.privacy_notice_jobs enable row level security;
CREATE INDEX privacy_notices_waiting_idx ON private.privacy_notice_jobs USING btree (next_attempt_at, id) WHERE (delivered_at IS NULL);
revoke all on private.privacy_notice_jobs from public;
