-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.partners (
  id uuid default gen_random_uuid() not null,
  account_id uuid not null,
  code text not null,
  status text default 'pending'::text not null,
  commission_bps integer,
  revision integer default 1 not null,
  created_by uuid not null,
  created_at timestamp with time zone default statement_timestamp() not null,
  updated_at timestamp with time zone default statement_timestamp() not null,
  constraint partners_account_id_fkey FOREIGN KEY (account_id) REFERENCES auth.users(id) ON DELETE RESTRICT,
  constraint partners_account_id_key UNIQUE (account_id),
  constraint partners_code_check CHECK (code ~ '^[A-Z0-9]{4,16}$'::text),
  constraint partners_code_key UNIQUE (code),
  constraint partners_commission_bps_check CHECK (commission_bps IS NULL OR commission_bps >= 0 AND commission_bps <= 5000),
  constraint partners_pkey PRIMARY KEY (id),
  constraint partners_revision_check CHECK (revision >= 1 AND revision <= 2147483647),
  constraint partners_status_check CHECK (status = ANY (ARRAY['pending'::text, 'active'::text, 'suspended'::text]))
);
alter table private.partners owner to postgres;
alter table private.partners enable row level security;
revoke all on private.partners from public;
