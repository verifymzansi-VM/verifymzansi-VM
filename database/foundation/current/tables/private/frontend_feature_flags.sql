-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.frontend_feature_flags (
  id uuid default gen_random_uuid() not null,
  key text not null,
  description text not null,
  mode text default 'off'::text not null,
  rollout_percent integer default 0 not null,
  allowlist_roles text[] default '{}'::text[] not null,
  revision integer default 1 not null,
  updated_by uuid,
  updated_at timestamp with time zone default clock_timestamp() not null,
  updated_reason text,
  constraint frontend_feature_flags_allowlist_roles_check CHECK (cardinality(allowlist_roles) <= 5 AND allowlist_roles <@ ARRAY['admin'::text, 'moderator'::text, 'governance_controller'::text, 'member'::text, 'buyer'::text]),
  constraint frontend_feature_flags_key_check CHECK (key = 'kyc_evidence_desk'::text),
  constraint frontend_feature_flags_key_key UNIQUE (key),
  constraint frontend_feature_flags_mode_check CHECK (mode = ANY (ARRAY['off'::text, 'on'::text, 'percent'::text, 'allowlist'::text])),
  constraint frontend_feature_flags_pkey PRIMARY KEY (id),
  constraint frontend_feature_flags_revision_check CHECK (revision > 0),
  constraint frontend_feature_flags_rollout_percent_check CHECK (rollout_percent >= 0 AND rollout_percent <= 100),
  constraint frontend_feature_flags_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL
);
alter table private.frontend_feature_flags owner to postgres;
alter table private.frontend_feature_flags enable row level security;
CREATE INDEX frontend_feature_flags_actor_idx ON private.frontend_feature_flags USING btree (updated_by);
revoke all on private.frontend_feature_flags from public;
