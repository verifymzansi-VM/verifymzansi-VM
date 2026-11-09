-- Generated from the replay of database/foundation by `pnpm db:foundation:snapshot`.
-- Do not edit; change the schema with a reviewed file in database/foundation/updates/.

create table private.frontend_post_commands (
  owner_id uuid not null,
  request_id uuid not null,
  digest text not null,
  payload jsonb,
  result jsonb,
  created_at timestamp with time zone default clock_timestamp() not null,
  expires_at timestamp with time zone default (clock_timestamp() + '24:00:00'::interval) not null,
  constraint frontend_post_commands_check CHECK (payload IS NOT NULL OR result IS NOT NULL),
  constraint frontend_post_commands_digest_check CHECK (digest ~ '^[a-f0-9]{64}$'::text),
  constraint frontend_post_commands_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE RESTRICT,
  constraint frontend_post_commands_payload_check CHECK (jsonb_typeof(payload) = 'object'::text AND octet_length(payload::text) <= 131072),
  constraint frontend_post_commands_pkey PRIMARY KEY (owner_id, request_id)
);
alter table private.frontend_post_commands owner to postgres;
alter table private.frontend_post_commands enable row level security;
revoke all on private.frontend_post_commands from public;
