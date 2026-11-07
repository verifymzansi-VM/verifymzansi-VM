-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.post_slugs (
  slug text not null,
  post_id uuid not null,
  constraint post_slugs_pkey PRIMARY KEY (slug),
  constraint post_slugs_post_id_fkey FOREIGN KEY (post_id) REFERENCES private.posts(id) ON DELETE CASCADE,
  constraint post_slugs_slug_check CHECK (slug ~ '^[a-z0-9-]{3,60}$'::text)
);
alter table private.post_slugs owner to postgres;
alter table private.post_slugs enable row level security;
CREATE INDEX post_slugs_post_idx ON private.post_slugs USING btree (post_id);
revoke all on private.post_slugs from public;
