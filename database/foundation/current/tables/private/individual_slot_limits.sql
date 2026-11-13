-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.individual_slot_limits (
  id uuid default gen_random_uuid() not null,
  identity_hmac text not null,
  account_id uuid not null,
  slot_limit integer not null,
  ends_at timestamp with time zone not null,
  reason text not null,
  granted_by uuid not null,
  granted_at timestamp with time zone default statement_timestamp() not null,
  revoked_at timestamp with time zone,
  revoked_by uuid,
  revoke_reason text,
  constraint individual_slot_limits_account_id_fkey FOREIGN KEY (account_id) REFERENCES auth.users(id) ON DELETE RESTRICT,
  constraint individual_slot_limits_check CHECK (granted_by <> account_id),
  constraint individual_slot_limits_check1 CHECK (ends_at > granted_at AND ends_at <= (granted_at + '366 days'::interval)),
  constraint individual_slot_limits_check2 CHECK ((revoked_at IS NULL) = (revoked_by IS NULL) AND (revoked_at IS NULL) = (revoke_reason IS NULL)),
  constraint individual_slot_limits_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES auth.users(id) ON DELETE RESTRICT,
  constraint individual_slot_limits_identity_hmac_check CHECK (identity_hmac ~ '^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$'::text),
  constraint individual_slot_limits_pkey PRIMARY KEY (id),
  constraint individual_slot_limits_reason_check CHECK (length(btrim(reason)) >= 5 AND length(btrim(reason)) <= 500),
  constraint individual_slot_limits_revoke_reason_check CHECK (length(btrim(revoke_reason)) >= 5 AND length(btrim(revoke_reason)) <= 500),
  constraint individual_slot_limits_revoked_by_fkey FOREIGN KEY (revoked_by) REFERENCES auth.users(id) ON DELETE RESTRICT,
  constraint individual_slot_limits_slot_limit_check CHECK (slot_limit >= 5 AND slot_limit <= 25)
);
alter table private.individual_slot_limits owner to postgres;
alter table private.individual_slot_limits enable row level security;
CREATE INDEX individual_slot_limits_account_idx ON private.individual_slot_limits USING btree (account_id);
CREATE UNIQUE INDEX individual_slot_limits_current_idx ON private.individual_slot_limits USING btree (identity_hmac) WHERE (revoked_at IS NULL);
CREATE INDEX individual_slot_limits_granted_by_idx ON private.individual_slot_limits USING btree (granted_by);
CREATE INDEX individual_slot_limits_revoked_by_idx ON private.individual_slot_limits USING btree (revoked_by) WHERE (revoked_by IS NOT NULL);
CREATE TRIGGER individual_slot_limits_immutable BEFORE DELETE OR UPDATE ON private.individual_slot_limits FOR EACH ROW EXECUTE FUNCTION internal.individual_slot_limit_guard();
revoke all on private.individual_slot_limits from public;
