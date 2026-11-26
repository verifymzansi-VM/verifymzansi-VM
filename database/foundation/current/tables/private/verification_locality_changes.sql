-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.verification_locality_changes (
  id uuid default gen_random_uuid() not null,
  owner_id uuid not null,
  from_province_id text not null,
  from_city_id text not null,
  to_province_id text not null,
  to_city_id text not null,
  changed_at timestamp with time zone default clock_timestamp() not null,
  constraint verification_locality_changes_check CHECK (from_province_id IS DISTINCT FROM to_province_id OR from_city_id IS DISTINCT FROM to_city_id),
  constraint verification_locality_changes_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES private.verification_localities(owner_id) ON DELETE CASCADE,
  constraint verification_locality_changes_pkey PRIMARY KEY (id)
);
alter table private.verification_locality_changes owner to postgres;
alter table private.verification_locality_changes enable row level security;
CREATE INDEX verification_locality_changes_owner_idx ON private.verification_locality_changes USING btree (owner_id, changed_at);
revoke all on private.verification_locality_changes from public;
