-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.organisation_notes (
  id uuid default gen_random_uuid() not null,
  organisation_id uuid not null,
  author_id uuid not null,
  note text not null,
  created_at timestamp with time zone default statement_timestamp() not null,
  constraint organisation_notes_note_check CHECK (internal.plain_text_valid(note, 1, 2000, true)),
  constraint organisation_notes_organisation_id_fkey FOREIGN KEY (organisation_id) REFERENCES private.organisations(id) ON DELETE CASCADE,
  constraint organisation_notes_pkey PRIMARY KEY (id)
);
alter table private.organisation_notes owner to postgres;
alter table private.organisation_notes enable row level security;
CREATE INDEX organisation_notes_org_idx ON private.organisation_notes USING btree (organisation_id, created_at DESC);
revoke all on private.organisation_notes from public;
