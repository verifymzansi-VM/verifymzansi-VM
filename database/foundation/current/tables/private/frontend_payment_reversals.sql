-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.frontend_payment_reversals (
  payment_id uuid not null,
  actor_id uuid not null,
  kind text not null,
  reason text not null,
  released_activations integer not null,
  created_at timestamp with time zone default statement_timestamp() not null,
  constraint frontend_payment_reversals_kind_check CHECK (kind = ANY (ARRAY['refunded'::text, 'chargeback'::text])),
  constraint frontend_payment_reversals_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES private.payments(id) ON DELETE CASCADE,
  constraint frontend_payment_reversals_pkey PRIMARY KEY (payment_id),
  constraint frontend_payment_reversals_reason_check CHECK (internal.plain_text_valid(reason, 5, 500, true)),
  constraint frontend_payment_reversals_released_activations_check CHECK (released_activations >= 0)
);
alter table private.frontend_payment_reversals owner to postgres;
alter table private.frontend_payment_reversals enable row level security;
revoke all on private.frontend_payment_reversals from public;
