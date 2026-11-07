-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.verification_localities (
  owner_id uuid not null,
  province_id text not null,
  city_id text not null,
  assurance text default 'self_declared'::text not null,
  confirmed_at timestamp with time zone default clock_timestamp() not null,
  constraint verification_localities_assurance_check CHECK (assurance = 'self_declared'::text),
  constraint verification_localities_city_id_province_id_fkey FOREIGN KEY (city_id, province_id) REFERENCES private.cities(id, province_id),
  constraint verification_localities_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE RESTRICT,
  constraint verification_localities_pkey PRIMARY KEY (owner_id)
);
alter table private.verification_localities owner to postgres;
alter table private.verification_localities enable row level security;
revoke all on private.verification_localities from public;
