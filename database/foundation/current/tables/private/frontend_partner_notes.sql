-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.frontend_partner_notes (
  id uuid default gen_random_uuid() not null,
  partner_id uuid not null,
  actor_id uuid,
  note text not null,
  created_at timestamp with time zone default clock_timestamp() not null,
  constraint frontend_partner_notes_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE SET NULL,
  constraint frontend_partner_notes_note_check CHECK (length(note) >= 1 AND length(note) <= 1000),
  constraint frontend_partner_notes_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES private.partners(id) ON DELETE CASCADE,
  constraint frontend_partner_notes_pkey PRIMARY KEY (id)
);
alter table private.frontend_partner_notes owner to postgres;
alter table private.frontend_partner_notes enable row level security;
CREATE INDEX frontend_partner_notes_actor_idx ON private.frontend_partner_notes USING btree (actor_id);
CREATE INDEX frontend_partner_notes_partner_idx ON private.frontend_partner_notes USING btree (partner_id, created_at);
revoke all on private.frontend_partner_notes from public;
