-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.privacy_request_events (
  id uuid default gen_random_uuid() not null,
  request_id uuid not null,
  actor_id uuid,
  action text not null,
  represented_revision integer not null,
  occurred_at timestamp with time zone default clock_timestamp() not null,
  export_id uuid,
  constraint privacy_request_events_action_check CHECK (action = ANY (ARRAY['submitted'::text, 'recorded'::text, 'assigned'::text, 'unassigned'::text, 'extended'::text, 'identity_verified'::text, 'started'::text, 'rejected'::text, 'completed'::text, 'exported'::text, 'erasure_ordered'::text, 'export_prepared'::text])),
  constraint privacy_request_events_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE SET NULL,
  constraint privacy_request_events_export_check CHECK (
CASE action
    WHEN 'export_prepared'::text THEN export_id IS NOT NULL
    WHEN 'exported'::text THEN true
    ELSE export_id IS NULL
END),
  constraint privacy_request_events_pkey PRIMARY KEY (id),
  constraint privacy_request_events_represented_revision_check CHECK (represented_revision > 0),
  constraint privacy_request_events_request_id_fkey FOREIGN KEY (request_id) REFERENCES private.privacy_requests(id) ON DELETE CASCADE
);
alter table private.privacy_request_events owner to postgres;
alter table private.privacy_request_events enable row level security;
CREATE INDEX privacy_events_actor_idx ON private.privacy_request_events USING btree (actor_id);
CREATE UNIQUE INDEX privacy_events_export_idx ON private.privacy_request_events USING btree (export_id, action) WHERE (export_id IS NOT NULL);
CREATE INDEX privacy_events_request_idx ON private.privacy_request_events USING btree (request_id, occurred_at);
revoke all on private.privacy_request_events from public;
