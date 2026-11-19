-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.post_engagement_totals (
  post_id uuid not null,
  views bigint default 0 not null,
  likes integer default 0 not null,
  like_hour_start timestamp with time zone,
  like_hour_count integer default 0 not null,
  constraint post_engagement_totals_counts_check CHECK (views >= 0 AND likes >= 0 AND like_hour_count >= 0 AND like_hour_count <= 600),
  constraint post_engagement_totals_pkey PRIMARY KEY (post_id),
  constraint post_engagement_totals_post_id_fkey FOREIGN KEY (post_id) REFERENCES private.posts(id) ON DELETE CASCADE
);
alter table private.post_engagement_totals owner to postgres;
alter table private.post_engagement_totals enable row level security;
revoke all on private.post_engagement_totals from public;
