-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.provider_events (
  id uuid default gen_random_uuid() not null,
  provider text not null,
  payload_sha256 text not null,
  merchant_reference text not null,
  provider_request_id text not null,
  provider_transaction_id text,
  reported_status text not null,
  amount_cents bigint not null,
  currency text not null,
  payment_id uuid,
  outcome text not null,
  received_at timestamp with time zone default statement_timestamp() not null,
  constraint provider_events_payload_sha256_check CHECK (payload_sha256 ~ '^[a-f0-9]{64}$'::text),
  constraint provider_events_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES private.payments(id) ON DELETE RESTRICT,
  constraint provider_events_pkey PRIMARY KEY (id),
  constraint provider_events_provider_check CHECK (provider = 'ozow'::text),
  constraint provider_events_provider_payload_sha256_key UNIQUE (provider, payload_sha256),
  constraint provider_events_reported_status_check CHECK (reported_status = ANY (ARRAY['complete'::text, 'cancelled'::text, 'error'::text, 'abandoned'::text, 'pending'::text]))
);
alter table private.provider_events owner to postgres;
alter table private.provider_events enable row level security;
revoke all on private.provider_events from public;
