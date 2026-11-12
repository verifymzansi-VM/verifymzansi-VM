-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.queue_claim_events (
  id bigint generated always as identity not null,
  post_id uuid,
  report_id uuid,
  actor_id uuid not null,
  event text not null,
  from_staff uuid not null,
  to_staff uuid,
  claim_generation bigint not null,
  reason text not null,
  created_at timestamp with time zone default statement_timestamp() not null,
  constraint queue_claim_events_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE RESTRICT,
  constraint queue_claim_events_check CHECK (num_nonnulls(post_id, report_id) = 1),
  constraint queue_claim_events_check1 CHECK ((event = 'reassigned'::text) = (to_staff IS NOT NULL)),
  constraint queue_claim_events_claim_generation_check CHECK (claim_generation > 0),
  constraint queue_claim_events_event_check CHECK (event = ANY (ARRAY['released_by_staff'::text, 'reassigned'::text])),
  constraint queue_claim_events_from_staff_fkey FOREIGN KEY (from_staff) REFERENCES auth.users(id) ON DELETE RESTRICT,
  constraint queue_claim_events_pkey PRIMARY KEY (id),
  constraint queue_claim_events_reason_check CHECK (length(reason) >= 5 AND length(reason) <= 500),
  constraint queue_claim_events_to_staff_fkey FOREIGN KEY (to_staff) REFERENCES auth.users(id) ON DELETE RESTRICT
);
alter table private.queue_claim_events owner to postgres;
alter table private.queue_claim_events enable row level security;
CREATE INDEX queue_claim_events_actor_id_idx ON private.queue_claim_events USING btree (actor_id);
CREATE INDEX queue_claim_events_audit_time_idx ON private.queue_claim_events USING btree (created_at DESC, id DESC);
CREATE INDEX queue_claim_events_from_staff_idx ON private.queue_claim_events USING btree (from_staff);
CREATE INDEX queue_claim_events_to_staff_idx ON private.queue_claim_events USING btree (to_staff) WHERE (to_staff IS NOT NULL);
CREATE TRIGGER queue_claim_events_append_only BEFORE DELETE OR UPDATE ON private.queue_claim_events FOR EACH ROW EXECUTE FUNCTION internal.append_only_guard();
CREATE TRIGGER queue_claim_events_no_truncate BEFORE TRUNCATE ON private.queue_claim_events FOR EACH STATEMENT EXECUTE FUNCTION internal.append_only_guard();
revoke all on private.queue_claim_events from public;
