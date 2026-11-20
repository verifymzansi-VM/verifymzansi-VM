-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.engagement_keys (
  id smallint default 1 not null,
  like_key bytea not null,
  created_at timestamp with time zone default statement_timestamp() not null,
  constraint engagement_keys_like_key_check CHECK (octet_length(like_key) = 32),
  constraint engagement_keys_one_check CHECK (id = 1),
  constraint engagement_keys_pkey PRIMARY KEY (id)
);
alter table private.engagement_keys owner to postgres;
alter table private.engagement_keys enable row level security;
revoke all on private.engagement_keys from public;
