-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.post_likes (
  id uuid default gen_random_uuid() not null,
  post_id uuid not null,
  device_mark bytea not null,
  account_id uuid,
  created_at timestamp with time zone default statement_timestamp() not null,
  constraint post_likes_account_id_fkey FOREIGN KEY (account_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint post_likes_device_mark_check CHECK (octet_length(device_mark) = 32),
  constraint post_likes_pkey PRIMARY KEY (id),
  constraint post_likes_post_id_fkey FOREIGN KEY (post_id) REFERENCES private.posts(id) ON DELETE CASCADE
);
alter table private.post_likes owner to postgres;
alter table private.post_likes enable row level security;
CREATE INDEX post_likes_account_id_idx ON private.post_likes USING btree (account_id) WHERE (account_id IS NOT NULL);
CREATE UNIQUE INDEX post_likes_account_idx ON private.post_likes USING btree (post_id, account_id) WHERE (account_id IS NOT NULL);
CREATE UNIQUE INDEX post_likes_device_idx ON private.post_likes USING btree (post_id, device_mark);
CREATE INDEX post_likes_post_created_idx ON private.post_likes USING btree (post_id, created_at);
revoke all on private.post_likes from public;
