-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.scheduled_job_runs (
  job text not null,
  last_run_at timestamp with time zone not null,
  constraint scheduled_job_runs_job_check CHECK (job ~ '^[a-z_]{1,40}$'::text),
  constraint scheduled_job_runs_pkey PRIMARY KEY (job)
);
alter table private.scheduled_job_runs owner to postgres;
alter table private.scheduled_job_runs enable row level security;
revoke all on private.scheduled_job_runs from public;
