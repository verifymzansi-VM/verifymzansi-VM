-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.frontend_feature_flag_events (
  id uuid default gen_random_uuid() not null,
  flag_id uuid not null,
  actor_id uuid,
  revision integer not null,
  mode text not null,
  rollout_percent integer not null,
  allowlist_roles text[] not null,
  reason text not null,
  created_at timestamp with time zone default clock_timestamp() not null,
  constraint frontend_feature_flag_events_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE SET NULL,
  constraint frontend_feature_flag_events_flag_id_fkey FOREIGN KEY (flag_id) REFERENCES private.frontend_feature_flags(id) ON DELETE CASCADE,
  constraint frontend_feature_flag_events_flag_id_revision_key UNIQUE (flag_id, revision),
  constraint frontend_feature_flag_events_mode_check CHECK (mode = ANY (ARRAY['off'::text, 'on'::text, 'percent'::text, 'allowlist'::text])),
  constraint frontend_feature_flag_events_pkey PRIMARY KEY (id),
  constraint frontend_feature_flag_events_reason_check CHECK (length(reason) >= 1 AND length(reason) <= 500),
  constraint frontend_feature_flag_events_revision_check CHECK (revision > 1),
  constraint frontend_feature_flag_events_rollout_percent_check CHECK (rollout_percent >= 0 AND rollout_percent <= 100)
);
alter table private.frontend_feature_flag_events owner to postgres;
alter table private.frontend_feature_flag_events enable row level security;
CREATE INDEX frontend_feature_flag_events_actor_idx ON private.frontend_feature_flag_events USING btree (actor_id);
revoke all on private.frontend_feature_flag_events from public;
