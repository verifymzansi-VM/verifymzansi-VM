-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.frontend_evidence_claim_events (
  id bigint generated always as identity not null,
  case_id uuid not null,
  actor_id uuid,
  from_staff uuid,
  to_staff uuid,
  event text not null,
  claim_generation bigint not null,
  reason text not null,
  created_at timestamp with time zone default statement_timestamp() not null,
  constraint frontend_evidence_claim_events_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE SET NULL,
  constraint frontend_evidence_claim_events_case_id_fkey FOREIGN KEY (case_id) REFERENCES private.evidence_cases(id) ON DELETE CASCADE,
  constraint frontend_evidence_claim_events_claim_generation_check CHECK (claim_generation > 0),
  constraint frontend_evidence_claim_events_event_check CHECK (event = ANY (ARRAY['released_by_staff'::text, 'reassigned'::text])),
  constraint frontend_evidence_claim_events_from_staff_fkey FOREIGN KEY (from_staff) REFERENCES auth.users(id) ON DELETE SET NULL,
  constraint frontend_evidence_claim_events_pkey PRIMARY KEY (id),
  constraint frontend_evidence_claim_events_reason_check CHECK (length(reason) >= 5 AND length(reason) <= 500),
  constraint frontend_evidence_claim_events_to_staff_fkey FOREIGN KEY (to_staff) REFERENCES auth.users(id) ON DELETE SET NULL
);
alter table private.frontend_evidence_claim_events owner to postgres;
alter table private.frontend_evidence_claim_events enable row level security;
CREATE INDEX frontend_evidence_claim_events_case_idx ON private.frontend_evidence_claim_events USING btree (case_id, created_at DESC);
revoke all on private.frontend_evidence_claim_events from public;
