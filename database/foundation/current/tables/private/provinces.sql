-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.provinces (
  id text not null,
  code text not null,
  label text not null,
  sort_order integer not null,
  constraint provinces_code_key UNIQUE (code),
  constraint provinces_id_check CHECK (id ~ '^[a-z][a-z0-9_]{0,79}$'::text),
  constraint provinces_label_key UNIQUE (label),
  constraint provinces_pkey PRIMARY KEY (id)
);
alter table private.provinces owner to postgres;
alter table private.provinces enable row level security;
revoke all on private.provinces from public;
