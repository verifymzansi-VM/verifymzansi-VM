-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.payment_activations (
  payment_id uuid not null,
  actor_id uuid not null,
  reason text not null,
  entitlements integer not null,
  addon_window boolean not null,
  commissions integer not null,
  created_at timestamp with time zone default statement_timestamp() not null,
  constraint payment_activations_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE RESTRICT,
  constraint payment_activations_commissions_check CHECK (commissions >= 0),
  constraint payment_activations_entitlements_check CHECK (entitlements >= 0),
  constraint payment_activations_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES private.payments(id) ON DELETE CASCADE,
  constraint payment_activations_pkey PRIMARY KEY (payment_id),
  constraint payment_activations_reason_check CHECK (internal.plain_text_valid(reason, 5, 500, true))
);
alter table private.payment_activations owner to postgres;
alter table private.payment_activations enable row level security;
CREATE INDEX payment_activations_actor_idx ON private.payment_activations USING btree (actor_id);
CREATE TRIGGER payment_activations_immutable BEFORE UPDATE ON private.payment_activations FOR EACH ROW EXECUTE FUNCTION internal.payment_activation_guard();
revoke all on private.payment_activations from public;
