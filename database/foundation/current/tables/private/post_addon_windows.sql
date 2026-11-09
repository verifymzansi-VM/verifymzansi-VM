-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.post_addon_windows (
  id uuid default gen_random_uuid() not null,
  post_id uuid not null,
  kind text not null,
  payment_id uuid not null,
  starts_at timestamp with time zone not null,
  ends_at timestamp with time zone not null,
  revoked_at timestamp with time zone,
  constraint post_addon_windows_check CHECK (ends_at > starts_at),
  constraint post_addon_windows_kind_check CHECK (kind = ANY (ARRAY['boost'::text, 'featured'::text, 'urgent'::text])),
  constraint post_addon_windows_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES private.payments(id) ON DELETE RESTRICT,
  constraint post_addon_windows_payment_id_key UNIQUE (payment_id),
  constraint post_addon_windows_pkey PRIMARY KEY (id)
);
alter table private.post_addon_windows owner to postgres;
alter table private.post_addon_windows enable row level security;
CREATE INDEX post_addon_windows_live_idx ON private.post_addon_windows USING btree (post_id, kind, ends_at) WHERE (revoked_at IS NULL);
revoke all on private.post_addon_windows from public;
