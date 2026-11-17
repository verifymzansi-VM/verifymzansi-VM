-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.intro_trial_requests (
  post_id uuid not null,
  owner_id uuid not null,
  requested_at timestamp with time zone default statement_timestamp() not null,
  constraint intro_trial_requests_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint intro_trial_requests_pkey PRIMARY KEY (post_id),
  constraint intro_trial_requests_post_id_fkey FOREIGN KEY (post_id) REFERENCES private.posts(id) ON DELETE CASCADE
);
alter table private.intro_trial_requests owner to postgres;
alter table private.intro_trial_requests enable row level security;
CREATE INDEX intro_trial_requests_owner_idx ON private.intro_trial_requests USING btree (owner_id);
revoke all on private.intro_trial_requests from public;
