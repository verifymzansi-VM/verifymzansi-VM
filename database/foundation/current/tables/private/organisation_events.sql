-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.organisation_events (
  id uuid default gen_random_uuid() not null,
  organisation_id uuid not null,
  actor_id uuid not null,
  action text not null,
  subject_id uuid,
  reason text,
  created_at timestamp with time zone default statement_timestamp() not null,
  constraint organisation_events_action_check CHECK (action ~ '^[a-z_]{3,60}$'::text),
  constraint organisation_events_organisation_id_fkey FOREIGN KEY (organisation_id) REFERENCES private.organisations(id) ON DELETE CASCADE,
  constraint organisation_events_pkey PRIMARY KEY (id),
  constraint organisation_events_reason_check CHECK (reason IS NULL OR internal.plain_text_valid(reason, 1, 1000, true))
);
alter table private.organisation_events owner to postgres;
alter table private.organisation_events enable row level security;
CREATE INDEX organisation_events_audit_time_idx ON private.organisation_events USING btree (created_at DESC, id DESC);
CREATE INDEX organisation_events_org_idx ON private.organisation_events USING btree (organisation_id, created_at DESC);
CREATE TRIGGER organisation_events_append_only BEFORE UPDATE ON private.organisation_events FOR EACH ROW EXECUTE FUNCTION internal.organisation_events_append_only();
revoke all on private.organisation_events from public;
