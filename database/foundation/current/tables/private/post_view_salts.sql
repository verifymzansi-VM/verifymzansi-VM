-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.post_view_salts (
  day date not null,
  salt bytea not null,
  created_at timestamp with time zone default statement_timestamp() not null,
  constraint post_view_salts_pkey PRIMARY KEY (day),
  constraint post_view_salts_salt_check CHECK (octet_length(salt) = 32)
);
alter table private.post_view_salts owner to postgres;
alter table private.post_view_salts enable row level security;
revoke all on private.post_view_salts from public;
