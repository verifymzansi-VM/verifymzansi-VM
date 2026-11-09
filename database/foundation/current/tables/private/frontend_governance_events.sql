-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.frontend_governance_events (
  id uuid default gen_random_uuid() not null,
  decision_id uuid not null,
  actor_id uuid,
  action text not null,
  reason text not null,
  case_version integer not null,
  created_at timestamp with time zone default clock_timestamp() not null,
  constraint frontend_governance_events_action_check CHECK (action = ANY (ARRAY['approve'::text, 'reject'::text, 'withdraw'::text, 'escalate'::text])),
  constraint frontend_governance_events_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE SET NULL,
  constraint frontend_governance_events_case_version_check CHECK (case_version > 0),
  constraint frontend_governance_events_decision_id_action_key UNIQUE (decision_id, action),
  constraint frontend_governance_events_decision_id_fkey FOREIGN KEY (decision_id) REFERENCES private.decisions(id) ON DELETE CASCADE,
  constraint frontend_governance_events_pkey PRIMARY KEY (id),
  constraint frontend_governance_events_reason_check CHECK (length(reason) >= 1 AND length(reason) <= 2000)
);
alter table private.frontend_governance_events owner to postgres;
alter table private.frontend_governance_events enable row level security;
CREATE INDEX frontend_governance_actor_idx ON private.frontend_governance_events USING btree (actor_id);
revoke all on private.frontend_governance_events from public;
