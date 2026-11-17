-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.frontend_post_hold_state (
  post_id uuid not null,
  prior_status text not null,
  prior_reason text,
  hidden_revision integer not null,
  content_changed boolean default false not null,
  constraint frontend_post_hold_state_hidden_revision_check CHECK (hidden_revision > 0),
  constraint frontend_post_hold_state_pkey PRIMARY KEY (post_id),
  constraint frontend_post_hold_state_post_id_fkey FOREIGN KEY (post_id) REFERENCES private.posts(id) ON DELETE CASCADE,
  constraint frontend_post_hold_state_prior_status_check CHECK (prior_status = ANY (ARRAY['live'::text, 'paused'::text]))
);
alter table private.frontend_post_hold_state owner to postgres;
alter table private.frontend_post_hold_state enable row level security;
revoke all on private.frontend_post_hold_state from public;
