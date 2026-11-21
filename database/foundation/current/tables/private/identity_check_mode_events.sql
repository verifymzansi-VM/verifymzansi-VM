-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.identity_check_mode_events (
  id uuid default gen_random_uuid() not null,
  from_mode text not null,
  to_mode text not null,
  changed_by uuid not null,
  reason text not null,
  changed_at timestamp with time zone default statement_timestamp() not null,
  constraint identity_check_mode_events_change_check CHECK (from_mode <> to_mode),
  constraint identity_check_mode_events_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES auth.users(id) ON DELETE RESTRICT,
  constraint identity_check_mode_events_from_mode_check CHECK (from_mode = ANY (ARRAY['manual'::text, 'staff_final'::text, 'automatic'::text])),
  constraint identity_check_mode_events_pkey PRIMARY KEY (id),
  constraint identity_check_mode_events_reason_check CHECK (char_length(reason) >= 5 AND char_length(reason) <= 500),
  constraint identity_check_mode_events_to_mode_check CHECK (to_mode = ANY (ARRAY['manual'::text, 'staff_final'::text, 'automatic'::text]))
);
alter table private.identity_check_mode_events owner to postgres;
alter table private.identity_check_mode_events enable row level security;
CREATE INDEX identity_check_mode_events_changed_at_idx ON private.identity_check_mode_events USING btree (changed_at DESC, id DESC);
CREATE INDEX identity_check_mode_events_changed_by_idx ON private.identity_check_mode_events USING btree (changed_by);
CREATE TRIGGER identity_check_mode_events_append_only BEFORE DELETE OR UPDATE ON private.identity_check_mode_events FOR EACH ROW EXECUTE FUNCTION internal.append_only_guard();
CREATE TRIGGER identity_check_mode_events_no_truncate BEFORE TRUNCATE ON private.identity_check_mode_events FOR EACH STATEMENT EXECUTE FUNCTION internal.append_only_guard();
revoke all on private.identity_check_mode_events from public;
comment on table private.identity_check_mode_events is 'Automatic ID checks: append-only log of setting changes (who, when, from, to, why).';
