-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.house_slot_events (
  id uuid default gen_random_uuid() not null,
  entitlement_id uuid not null,
  action text not null,
  ends_at timestamp with time zone not null,
  approved_by uuid,
  reason text not null,
  recorded_at timestamp with time zone default statement_timestamp() not null,
  self_granted boolean default false not null,
  constraint house_slot_events_action_check CHECK (action = ANY (ARRAY['granted'::text, 'extended'::text, 'ended'::text])),
  constraint house_slot_events_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES auth.users(id) ON DELETE RESTRICT,
  constraint house_slot_events_approver_check CHECK ((action = 'ended'::text) = (approved_by IS NULL)),
  constraint house_slot_events_entitlement_id_fkey FOREIGN KEY (entitlement_id) REFERENCES private.entitlements(id) ON DELETE CASCADE,
  constraint house_slot_events_pkey PRIMARY KEY (id),
  constraint house_slot_events_reason_check CHECK (char_length(reason) >= 5 AND char_length(reason) <= 500),
  constraint house_slot_events_self_granted_check CHECK (NOT self_granted OR (action = ANY (ARRAY['granted'::text, 'extended'::text])))
);
alter table private.house_slot_events owner to postgres;
alter table private.house_slot_events enable row level security;
CREATE INDEX house_slot_events_approved_by_idx ON private.house_slot_events USING btree (approved_by) WHERE (approved_by IS NOT NULL);
CREATE INDEX house_slot_events_entitlement_idx ON private.house_slot_events USING btree (entitlement_id, recorded_at);
CREATE TRIGGER house_slot_events_append_only BEFORE DELETE OR UPDATE ON private.house_slot_events FOR EACH ROW EXECUTE FUNCTION internal.append_only_guard();
CREATE TRIGGER house_slot_events_no_truncate BEFORE TRUNCATE ON private.house_slot_events FOR EACH STATEMENT EXECUTE FUNCTION internal.append_only_guard();
revoke all on private.house_slot_events from public;
comment on column private.house_slot_events.self_granted is 'Granted or extended in single-administrator mode: the only ID-verified staff member approved a grant to their own admin account (internal.grant_house_slots).';
