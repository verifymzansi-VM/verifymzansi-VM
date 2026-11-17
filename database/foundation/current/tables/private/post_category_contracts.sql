-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.post_category_contracts (
  category_key text not null,
  kind text not null,
  area text not null,
  constraint post_category_contracts_pkey PRIMARY KEY (category_key, kind, area)
);
alter table private.post_category_contracts owner to postgres;
alter table private.post_category_contracts enable row level security;
revoke all on private.post_category_contracts from public;
