-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.post_likes (
  id uuid default gen_random_uuid() not null,
  post_id uuid not null,
  device_mark bytea,
  account_id uuid,
  created_at timestamp with time zone default statement_timestamp() not null,
  constraint post_likes_account_id_fkey FOREIGN KEY (account_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint post_likes_device_mark_check CHECK (device_mark IS NULL OR octet_length(device_mark) = 32),
  constraint post_likes_one_liker_check CHECK (num_nonnulls(device_mark, account_id) = 1),
  constraint post_likes_pkey PRIMARY KEY (id),
  constraint post_likes_post_id_fkey FOREIGN KEY (post_id) REFERENCES private.posts(id) ON DELETE CASCADE
);
alter table private.post_likes owner to postgres;
alter table private.post_likes enable row level security;
CREATE INDEX post_likes_account_id_idx ON private.post_likes USING btree (account_id) WHERE (account_id IS NOT NULL);
CREATE UNIQUE INDEX post_likes_account_idx ON private.post_likes USING btree (post_id, account_id) WHERE (account_id IS NOT NULL);
CREATE UNIQUE INDEX post_likes_device_idx ON private.post_likes USING btree (post_id, device_mark) WHERE (device_mark IS NOT NULL);
CREATE INDEX post_likes_post_id_idx ON private.post_likes USING btree (post_id);
CREATE TRIGGER post_likes_count AFTER INSERT OR DELETE ON private.post_likes FOR EACH ROW EXECUTE FUNCTION internal.post_likes_count();
revoke all on private.post_likes from public;
