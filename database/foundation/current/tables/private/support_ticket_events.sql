-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.support_ticket_events (
  ticket_id uuid not null,
  revision integer not null,
  actor_id uuid,
  status text not null,
  created_at timestamp with time zone default clock_timestamp() not null,
  constraint support_ticket_events_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE SET NULL,
  constraint support_ticket_events_pkey PRIMARY KEY (ticket_id, revision),
  constraint support_ticket_events_revision_check CHECK (revision > 1),
  constraint support_ticket_events_status_check CHECK (status = ANY (ARRAY['new'::text, 'in_progress'::text, 'resolved'::text])),
  constraint support_ticket_events_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES private.support_tickets(id) ON DELETE CASCADE
);
alter table private.support_ticket_events owner to postgres;
alter table private.support_ticket_events enable row level security;
CREATE INDEX support_ticket_events_actor_idx ON private.support_ticket_events USING btree (actor_id);
revoke all on private.support_ticket_events from public;
