-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.frontend_offline_post_reviews (
  log_id bigint not null,
  post_id uuid not null,
  price_only boolean not null,
  decided_at timestamp with time zone not null,
  constraint frontend_offline_post_reviews_log_id_fkey FOREIGN KEY (log_id) REFERENCES private.moderation_log(id) ON DELETE CASCADE,
  constraint frontend_offline_post_reviews_pkey PRIMARY KEY (log_id),
  constraint frontend_offline_post_reviews_post_id_fkey FOREIGN KEY (post_id) REFERENCES private.posts(id) ON DELETE CASCADE
);
alter table private.frontend_offline_post_reviews owner to postgres;
alter table private.frontend_offline_post_reviews enable row level security;
CREATE INDEX frontend_offline_post_reviews_post_idx ON private.frontend_offline_post_reviews USING btree (post_id, decided_at);
revoke all on private.frontend_offline_post_reviews from public;
