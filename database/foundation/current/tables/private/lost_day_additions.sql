-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.lost_day_additions (
  id uuid default gen_random_uuid() not null,
  request_id uuid not null,
  entitlement_id uuid not null,
  actor_id uuid not null,
  days integer not null,
  starts_before timestamp with time zone not null,
  starts_after timestamp with time zone not null,
  ends_before timestamp with time zone not null,
  ends_after timestamp with time zone not null,
  reason text not null,
  created_at timestamp with time zone default statement_timestamp() not null,
  constraint lost_day_additions_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE RESTRICT,
  constraint lost_day_additions_dates CHECK (starts_after >= starts_before AND ends_after > ends_before),
  constraint lost_day_additions_days_check CHECK (days >= 1 AND days <= 30),
  constraint lost_day_additions_entitlement_id_fkey FOREIGN KEY (entitlement_id) REFERENCES private.entitlements(id) ON DELETE CASCADE,
  constraint lost_day_additions_pkey PRIMARY KEY (id),
  constraint lost_day_additions_reason_check CHECK (char_length(reason) >= 5 AND char_length(reason) <= 500),
  constraint lost_day_additions_request_grant UNIQUE (request_id, entitlement_id)
);
alter table private.lost_day_additions owner to postgres;
alter table private.lost_day_additions enable row level security;
CREATE INDEX lost_day_additions_actor_idx ON private.lost_day_additions USING btree (actor_id);
CREATE INDEX lost_day_additions_entitlement_idx ON private.lost_day_additions USING btree (entitlement_id, created_at);
CREATE TRIGGER lost_day_additions_append_only BEFORE DELETE OR UPDATE ON private.lost_day_additions FOR EACH ROW EXECUTE FUNCTION internal.append_only_guard();
CREATE TRIGGER lost_day_additions_no_truncate BEFORE TRUNCATE ON private.lost_day_additions FOR EACH STATEMENT EXECUTE FUNCTION internal.append_only_guard();
revoke all on private.lost_day_additions from public;
comment on table private.lost_day_additions is 'Lost days (20261125113433_add_lost_days.sql): every paid grant a staff member moved to add days a member lost, with the reason. Append-only; deleted only with the grant (commerce retention).';
