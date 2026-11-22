-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.free_credit_events (
  id uuid default gen_random_uuid() not null,
  entitlement_id uuid not null,
  action text not null,
  actor_id uuid not null,
  posts integer not null,
  days integer not null,
  ends_at timestamp with time zone not null,
  reason text not null,
  created_at timestamp with time zone default statement_timestamp() not null,
  constraint free_credit_events_action_check CHECK (action = ANY (ARRAY['given'::text, 'extended'::text])),
  constraint free_credit_events_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE RESTRICT,
  constraint free_credit_events_days_check CHECK (days >= 1 AND days <= 30),
  constraint free_credit_events_entitlement_id_fkey FOREIGN KEY (entitlement_id) REFERENCES private.entitlements(id) ON DELETE CASCADE,
  constraint free_credit_events_pkey PRIMARY KEY (id),
  constraint free_credit_events_posts_check CHECK (posts >= 1 AND posts <= 6),
  constraint free_credit_events_reason_check CHECK (char_length(reason) >= 5 AND char_length(reason) <= 200)
);
alter table private.free_credit_events owner to postgres;
alter table private.free_credit_events enable row level security;
CREATE INDEX free_credit_events_actor_idx ON private.free_credit_events USING btree (actor_id);
CREATE INDEX free_credit_events_entitlement_idx ON private.free_credit_events USING btree (entitlement_id, created_at);
CREATE TRIGGER free_credit_events_append_only BEFORE DELETE OR UPDATE ON private.free_credit_events FOR EACH ROW EXECUTE FUNCTION internal.append_only_guard();
CREATE TRIGGER free_credit_events_no_truncate BEFORE TRUNCATE ON private.free_credit_events FOR EACH STATEMENT EXECUTE FUNCTION internal.append_only_guard();
revoke all on private.free_credit_events from public;
comment on table private.free_credit_events is 'Free credits (20261122130744_free_credits.sql): every gift and extension an admin made, with the reason. Append-only; deleted only with the gift''s entitlement (commerce retention).';
