-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.partner_events (
  id uuid default gen_random_uuid() not null,
  partner_id uuid not null,
  commission_id uuid,
  actor_id uuid not null,
  action text not null,
  reason text not null,
  created_at timestamp with time zone default statement_timestamp() not null,
  constraint partner_events_action_check CHECK (action ~ '^[a-z_]{3,60}$'::text),
  constraint partner_events_commission_id_fkey FOREIGN KEY (commission_id) REFERENCES private.partner_commissions(id) ON DELETE RESTRICT,
  constraint partner_events_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES private.partners(id) ON DELETE RESTRICT,
  constraint partner_events_pkey PRIMARY KEY (id),
  constraint partner_events_reason_check CHECK (internal.plain_text_valid(reason, 5, 500, true))
);
alter table private.partner_events owner to postgres;
alter table private.partner_events enable row level security;
CREATE INDEX partner_events_audit_time_idx ON private.partner_events USING btree (created_at DESC, id DESC);
CREATE INDEX partner_events_commission_idx ON private.partner_events USING btree (commission_id) WHERE (commission_id IS NOT NULL);
CREATE INDEX partner_events_partner_idx ON private.partner_events USING btree (partner_id, created_at DESC);
CREATE TRIGGER partner_events_append_only BEFORE UPDATE ON private.partner_events FOR EACH ROW EXECUTE FUNCTION internal.organisation_events_append_only();
revoke all on private.partner_events from public;
