-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.post_view_marks (
  mark bytea not null,
  seen_at timestamp with time zone default statement_timestamp() not null,
  constraint post_view_marks_mark_check CHECK (octet_length(mark) = 32),
  constraint post_view_marks_pkey PRIMARY KEY (mark)
);
alter table private.post_view_marks owner to postgres;
alter table private.post_view_marks enable row level security;
CREATE INDEX post_view_marks_seen_at_idx ON private.post_view_marks USING btree (seen_at);
revoke all on private.post_view_marks from public;
