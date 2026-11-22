-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.post_copies (
  post_id uuid not null,
  source_post_id uuid not null,
  source_photo_sha256 text[] not null,
  request_id uuid not null,
  created_at timestamp with time zone default statement_timestamp() not null,
  constraint post_copies_check CHECK (source_post_id <> post_id),
  constraint post_copies_pkey PRIMARY KEY (post_id),
  constraint post_copies_post_id_fkey FOREIGN KEY (post_id) REFERENCES private.posts(id) ON DELETE CASCADE,
  constraint post_copies_request_id_key UNIQUE (request_id)
);
alter table private.post_copies owner to postgres;
alter table private.post_copies enable row level security;
revoke all on private.post_copies from public;
