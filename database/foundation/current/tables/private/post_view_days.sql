-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.post_view_days (
  post_id uuid not null,
  day date not null,
  views integer not null,
  constraint post_view_days_pkey PRIMARY KEY (post_id, day),
  constraint post_view_days_post_id_fkey FOREIGN KEY (post_id) REFERENCES private.posts(id) ON DELETE CASCADE,
  constraint post_view_days_views_check CHECK (views >= 1)
);
alter table private.post_view_days owner to postgres;
alter table private.post_view_days enable row level security;
revoke all on private.post_view_days from public;
