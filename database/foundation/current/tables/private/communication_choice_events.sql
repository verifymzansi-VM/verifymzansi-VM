-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.communication_choice_events (
  id uuid default gen_random_uuid() not null,
  account_id uuid not null,
  purpose text not null,
  granted boolean not null,
  wording_version text not null,
  recorded_at timestamp with time zone default clock_timestamp() not null,
  constraint communication_choice_events_account_id_fkey FOREIGN KEY (account_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint communication_choice_events_pkey PRIMARY KEY (id),
  constraint communication_choice_events_purpose_check CHECK (purpose = ANY (ARRAY['marketing_email'::text, 'marketing_sms'::text, 'analytics'::text, 'third_party_sharing'::text])),
  constraint communication_choice_events_wording_version_check CHECK (wording_version ~ '^[a-z0-9][a-z0-9-]{0,39}$'::text)
);
alter table private.communication_choice_events owner to postgres;
alter table private.communication_choice_events enable row level security;
CREATE INDEX communication_choice_events_account_idx ON private.communication_choice_events USING btree (account_id, purpose, recorded_at DESC);
CREATE TRIGGER communication_choice_events_immutable BEFORE DELETE OR UPDATE ON private.communication_choice_events FOR EACH ROW EXECUTE FUNCTION internal.guard_consent_record();
revoke all on private.communication_choice_events from public;
