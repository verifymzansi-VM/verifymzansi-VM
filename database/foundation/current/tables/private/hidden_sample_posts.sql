-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.hidden_sample_posts (
  slug text not null,
  hidden_by uuid,
  hidden_at timestamp with time zone default clock_timestamp() not null,
  constraint hidden_sample_posts_hidden_by_fkey FOREIGN KEY (hidden_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  constraint hidden_sample_posts_pkey PRIMARY KEY (slug),
  constraint hidden_sample_posts_slug_check CHECK (length(slug) >= 3 AND length(slug) <= 80 AND slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text)
);
alter table private.hidden_sample_posts owner to postgres;
alter table private.hidden_sample_posts enable row level security;
CREATE INDEX hidden_sample_posts_hidden_by_idx ON private.hidden_sample_posts USING btree (hidden_by);
revoke all on private.hidden_sample_posts from public;
