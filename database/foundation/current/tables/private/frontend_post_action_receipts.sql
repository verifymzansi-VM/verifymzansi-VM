-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.frontend_post_action_receipts (
  owner_id uuid not null,
  request_id uuid not null,
  post_id uuid not null,
  expected_revision integer not null,
  action text not null,
  kind text not null,
  area text not null,
  result jsonb not null,
  created_at timestamp with time zone default clock_timestamp() not null,
  constraint frontend_post_action_receipts_action_check CHECK (action = ANY (ARRAY['delete'::text, 'resubmit'::text, 'deactivate'::text, 'mark_sold'::text, 'reactivate'::text])),
  constraint frontend_post_action_receipts_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE RESTRICT,
  constraint frontend_post_action_receipts_pkey PRIMARY KEY (owner_id, request_id)
);
alter table private.frontend_post_action_receipts owner to postgres;
alter table private.frontend_post_action_receipts enable row level security;
CREATE INDEX frontend_post_action_retention_idx ON private.frontend_post_action_receipts USING btree (created_at);
revoke all on private.frontend_post_action_receipts from public;
