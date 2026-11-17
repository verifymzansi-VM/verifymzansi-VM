-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.post_deletion_extensions (
  post_id uuid not null,
  ended_at timestamp with time zone not null,
  grace_ended_at timestamp with time zone not null,
  payment_id uuid not null,
  extended_at timestamp with time zone default statement_timestamp() not null,
  kept_at timestamp with time zone,
  constraint post_deletion_extensions_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES private.payments(id) ON DELETE CASCADE,
  constraint post_deletion_extensions_pkey PRIMARY KEY (post_id),
  constraint post_deletion_extensions_post_id_fkey FOREIGN KEY (post_id) REFERENCES private.posts(id) ON DELETE CASCADE
);
alter table private.post_deletion_extensions owner to postgres;
alter table private.post_deletion_extensions enable row level security;
CREATE INDEX post_deletion_extensions_payment_idx ON private.post_deletion_extensions USING btree (payment_id);
revoke all on private.post_deletion_extensions from public;
