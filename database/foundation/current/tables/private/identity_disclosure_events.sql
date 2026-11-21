-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.identity_disclosure_events (
  id uuid default gen_random_uuid() not null,
  disclosure_id uuid not null,
  staff_id uuid not null,
  kind text not null,
  subject_id uuid,
  occurred_at timestamp with time zone default clock_timestamp() not null,
  constraint identity_disclosure_events_disclosure_id_fkey FOREIGN KEY (disclosure_id) REFERENCES private.identity_disclosures(id) ON DELETE CASCADE,
  constraint identity_disclosure_events_kind_check CHECK (kind = ANY (ARRAY['viewed'::text, 'printed'::text, 'selfie_viewed'::text])),
  constraint identity_disclosure_events_pkey PRIMARY KEY (id),
  constraint identity_disclosure_events_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES auth.users(id) ON DELETE RESTRICT,
  constraint identity_disclosure_events_subject_check CHECK ((kind = 'selfie_viewed'::text) = (subject_id IS NOT NULL))
);
alter table private.identity_disclosure_events owner to postgres;
alter table private.identity_disclosure_events enable row level security;
CREATE INDEX identity_disclosure_events_disclosure_idx ON private.identity_disclosure_events USING btree (disclosure_id, kind);
CREATE INDEX identity_disclosure_events_staff_idx ON private.identity_disclosure_events USING btree (staff_id);
CREATE TRIGGER identity_disclosure_events_append_only BEFORE DELETE OR UPDATE ON private.identity_disclosure_events FOR EACH ROW EXECUTE FUNCTION internal.append_only_guard();
CREATE TRIGGER identity_disclosure_events_no_truncate BEFORE TRUNCATE ON private.identity_disclosure_events FOR EACH STATEMENT EXECUTE FUNCTION internal.append_only_guard();
revoke all on private.identity_disclosure_events from public;
comment on table private.identity_disclosure_events is 'Authority requests: append-only record of every look at an open disclosure (viewed, printed, selfie_viewed) and of an early close.';
