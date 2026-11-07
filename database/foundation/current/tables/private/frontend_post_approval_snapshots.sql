-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.frontend_post_approval_snapshots (
  post_id uuid not null,
  digest text not null,
  approved_at timestamp with time zone not null,
  structural_digest text,
  constraint frontend_post_approval_snapshots_digest_check CHECK (digest ~ '^[a-f0-9]{64}$'::text),
  constraint frontend_post_approval_snapshots_pkey PRIMARY KEY (post_id),
  constraint frontend_post_approval_snapshots_post_id_fkey FOREIGN KEY (post_id) REFERENCES private.posts(id) ON DELETE CASCADE,
  constraint frontend_post_approval_snapshots_structural_digest_check CHECK (structural_digest ~ '^[a-f0-9]{64}$'::text)
);
alter table private.frontend_post_approval_snapshots owner to postgres;
alter table private.frontend_post_approval_snapshots enable row level security;
revoke all on private.frontend_post_approval_snapshots from public;
