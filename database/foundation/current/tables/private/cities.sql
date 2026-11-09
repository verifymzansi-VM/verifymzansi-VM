-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.cities (
  id text not null,
  province_id text not null,
  label text not null,
  sort_order integer not null,
  constraint cities_id_check CHECK (id ~ '^[a-z][a-z0-9_]{0,79}$'::text),
  constraint cities_id_province_id_key UNIQUE (id, province_id),
  constraint cities_pkey PRIMARY KEY (id),
  constraint cities_province_id_fkey FOREIGN KEY (province_id) REFERENCES private.provinces(id)
);
alter table private.cities owner to postgres;
alter table private.cities enable row level security;
revoke all on private.cities from public;
